---
title: A search tool over a hashline engine must produce snapshots and mirror the engine's format
date: 2026-06-14
category: architecture-patterns
module: search-tool
problem_type: architecture_pattern
component: tooling
severity: medium
applies_when:
  - Adding a search/grep tool to a hashline or snapshot-based editing harness
  - Mirroring an upstream reference tool (oh-my-pi) into this plugin
  - Deciding which format layer to match when a dependency has a published package and a newer in-repo variant
tags: [hashline, search, oh-my-pi, mcp, edit-tool, snapshot, tool-design]
---

# A search tool over a hashline engine must produce snapshots and mirror the engine's format

## Context

We added a `search` (regex grep) tool to the hashline MCP plugin, which already
exposed `read` and `edit`. The whole point of the feature was to let the model
locate code and edit it **without** first reading the whole file just to obtain
line tags. Two design questions had non-obvious answers, both resolved by reading
oh-my-pi's actual implementation rather than guessing: (1) what state must
`search` establish to make edit-without-read work, and (2) which output format to
emit when the dependency ships a published package *and* a newer in-repo variant
that disagree.

## Guidance

**1. Make `search` a snapshot producer, match-gated.** In a hashline engine,
`edit` is gated on a recorded whole-file snapshot (the `#TAG` proves the file is
unchanged). For the model to edit straight off a search hit, `search` must record
that snapshot itself — exactly as `read` does. oh-my-pi treats `read` / `search` /
`write` as the three snapshot producers. Record only files that actually matched
(match-gated), so a broad search doesn't bloat the snapshot store.

**2. Mirror the format of the engine layer you depend on — not a newer variant.**
The published `@oh-my-pi/hashline` package (what `read`/`edit` are built on) uses a
**whole-file `#TAG` header + `LINE:TEXT` rows**. The current oh-my-pi *harness*
uses **per-line hashes** (`LINEHASH|TEXT`). Adopting the per-line format for
`search` would desync it from the very engine our `edit` validates against. Match
`read`'s output exactly so all three tools share one contract.

**3. Adopt the upstream tool's model-facing conventions verbatim.** From
oh-my-pi's `search` (`packages/coding-agent/src/tools/match-line-format.ts` and
`docs/tools/search.md`): match lines are prefixed `*`, context lines a single
space (column-aligned, never padded); context is asymmetric — 1 line before, 3
after; case-insensitivity is an `i` boolean (not a raw flags string); over-long
lines truncate to 512 columns with `…`; no-match returns `No matches found`.

**4. Stay in-process; don't shell out.** oh-my-pi links ripgrep in-process to
avoid fork-exec and missing-binary failures. When no native binding is available,
an in-process language-level file walk (skipping `node_modules`/dot-dirs, with
size and result caps) is the pragmatic analog — same philosophy, no `rg`
dependency.

## Why This Matters

- **Snapshot-on-match is the feature.** Without it, the model still pays a
  whole-file `read` before every edit — the exact cost the search tool exists to
  remove. The load-bearing proof is an integration test: `edit` anchored on a
  search hit succeeds with **no** prior `read`.
- **Format consistency keeps edits validatable.** The `edit` engine parses
  `[PATH#TAG]` + bare line numbers. A search tool emitting a different anchor
  shape would hand the model anchors its own `edit` can't accept.
- **Markers prevent mis-anchored edits.** Without the `*`/space distinction the
  model can't tell a hit from its context and may anchor an edit on the wrong
  line.

## When to Apply

- Adding any search/grep/navigation tool to a snapshot-or-tag-based editor.
- Mirroring an upstream tool whose published package and in-repo source differ —
  match the layer your other tools actually consume.

## Examples

Snapshot-on-match (the edit-without-read enabler):

```ts
// Only matched files are recorded, so the model can edit straight off a hit.
if (hitSet.size === 0) continue;
const key = ctx.fs.canonicalPath(rel);
const hash = ctx.snapshots.record(key, normalized); // same call read() makes
// ... render under formatHashlineHeader(rel, hash)
```

Match/context line format (mirrors oh-my-pi's `formatMatchLine`, hashline mode):

```ts
function formatMatchLine(lineNumber: number, line: string, isMatch: boolean) {
  const text = line.length > 512 ? `${line.slice(0, 512)}…` : line;
  return `${isMatch ? "*" : " "}${lineNumber}:${text}`; // "*5:hit" / " 4:context"
}
```

Verifying the upstream contract before implementing: clone the reference repo and
read the source (`git clone --depth 1 https://github.com/can1357/oh-my-pi`,
`docs/tools/search.md`) rather than inferring format from a blog post — the post
showed an older per-line-hash shape that does not match the published package.

## Related

- `src/core.ts` — `hashlineSearch` adapter; `src/descriptions.ts` — steering prompt.
- [[Hashline]], [[TAG]], [[Workspace jail]] (CONCEPTS.md).
- `docs/solutions/security-issues/jailed-filesystem-symlink-containment.md` — the
  containment gate the search walk also relies on.
