---
title: "Driving ripgrep --json as a library: the non-obvious flags and exit codes"
date: 2026-06-14
category: tooling-decisions
module: search-tool
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - Embedding ripgrep (@vscode/ripgrep) in a Node/Bun tool instead of a hand-rolled walker
  - Parsing rg --json output into a custom per-file format
  - A search tool must honor .gitignore over a workspace that may not be a git repo
tags: [ripgrep, vscode-ripgrep, search, gitignore, bun, subprocess, json, hashline]
---

# Driving ripgrep --json as a library: the non-obvious flags and exit codes

## Context

We replaced a hand-rolled file-walk + JS-`RegExp` search with ripgrep, spawned via
`@vscode/ripgrep` and consumed through `rg --json`. The swap eliminates the ReDoS
class (linear-time RE2 engine) and gives nested-`.gitignore`, `paths` scoping, and
multiline for free. But several ripgrep behaviors are silent traps when you drive
it as a library rather than a terminal command — each one cost a verification cycle
to catch, and most would have shipped a subtly-wrong tool if trusted from docs alone.

## Guidance

**1. `.gitignore` is ignored unless you pass `--no-require-git`.** ripgrep only
applies `.gitignore` rules when it finds itself inside a git repository. Over a bare
directory (a temp dir, an extracted tarball, any non-repo workspace) it silently
searches ignored files. If your tool must honor `.gitignore` regardless of git
presence — matching what the `ignore` npm package did — pass `--no-require-git`.
`.ignore` / `.rgignore` are always honored; only `.gitignore` is gated on git.

**2. Exit code 1 means "no matches", not "error".** ripgrep exits `0` on matches,
`1` on zero matches, `>=2` on a real error (bad pattern, unreadable path). A naive
"non-zero == failure" check turns every empty result into a thrown error. Treat `1`
as a clean empty stream; only throw on `>= 2` (and read stderr for the message).

**3. Pass the pattern with `-e`.** A pattern beginning with `-` (e.g. `-->`) is
otherwise parsed as a flag. `-e <pattern>` (or `--regexp=`) forces it to be treated
as the pattern.

**4. Output order is non-deterministic without `--sort path`.** ripgrep is
multi-threaded; file order varies run to run. `--sort path` forces single-threaded,
deterministic output — worth it for a model-facing tool and for stable test/benchmark
comparisons, at some throughput cost (the result cap bounds it anyway).

**5. The `--json` stream is one JSON object per line**, typed `begin` / `match` /
`context` / `end` / `summary`. `begin.data.path.text` names the file; `match` and
`context` carry `data.line_number` and `data.lines.text` (the latter includes the
trailing newline — strip it); `match` also carries `data.submatches[]` column
offsets. `path.text` is absent when bytes aren't valid UTF-8 (rg emits `data.bytes`
instead) — skip those. With `-B1 -A3`, ripgrep emits already-windowed, overlap-merged
context, so client-side window merging is unnecessary.

**6. The regex dialect is Rust/RE2, not the host language's.** No backreferences,
no lookbehind. A `\n` literal in the pattern is rejected (exit 2) unless multiline
(`-U`) is on. Document this for callers; for code search it is an upgrade, but it is
a behavior change from a JS/PCRE engine.

**7. `@vscode/ripgrep` ships prebuilt binaries** as per-platform optional
dependencies (no postinstall network download) and exports `rgPath`. Spawn it with
an array argv (no shell), so a model-supplied pattern cannot inject shell syntax.
Kill the process if the consumer stops early (a result cap) so it does not linger.

## Why This Matters

- **The gitignore trap is silent and only shows outside a git repo** — unit tests
  in temp dirs (not git repos) are exactly where it bites, so a tool that looks
  correct in-repo leaks ignored files in tests and any non-repo workspace.
- **Exit-code-1-as-error** would make every no-match query throw, which a caller
  reads as a broken tool rather than an empty result.
- **Determinism** matters twice: a model re-running the same search should see stable
  output, and a benchmark comparing arms needs reproducible ordering.

## When to Apply

- Any time you embed ripgrep in a tool and parse `--json` rather than reading its
  terminal output.
- Especially when the search root is not guaranteed to be a git repository.

## Examples

Base argv for a windowed, deterministic, gitignore-honoring search:

```
rg --json -B1 -A3 --no-require-git --sort path [-i] [--no-ignore] [-U] -e <pattern> [<paths>...]
```

Exit-code handling (Bun):

```ts
const code = await proc.exited;
if (code >= 2) throw new Error(`ripgrep failed (exit ${code}): ${await readStderr()}`);
// code 0 (matches) and code 1 (no matches) are both normal.
```

Snapshot-on-`begin` (preserves edit-without-read; only matched files are read):

```ts
if (msg.type === "begin") {
  const rel = stripLeadingDotSlash(msg.data.path.text);  // rg prefixes "./"
  const normalized = normalizeToLF(stripBom(await fs.readText(rel)).text);
  hash = snapshots.record(fs.canonicalPath(rel), normalized); // match-gated
}
```

## Related

- `docs/solutions/architecture-patterns/snapshot-producing-search-tool.md` — the
  search-tool design; its "stay in-process" decision was superseded by this adoption.
- `docs/solutions/design-patterns/benchmarking-a-locate-then-edit-tool.md` — how the
  swap was verified for no-regression.
- `src/ripgrep.ts` — the spawn + `--json` stream adapter and argv builder.
- [[Snapshot]], [[TAG]], [[Workspace jail]] (CONCEPTS.md).
