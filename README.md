# claude-hashline

Replaces `str_replace`-style editing in Claude Code with **hashline**: a
line-anchored patch language. Instead of reproducing exact old text (and hitting
"String to replace not found" retry loops), the model reads a file tagged with a
whole-file content hash and edits by line number:

```
[src/app.ts#9A46]
1:export function hello() {
2:  return "world";
3:}
```

```
[src/app.ts#9A46]
replace 2..2:
+  return "hashline";
```

The patch engine is the published, MIT-licensed
[`@oh-my-pi/hashline`](https://github.com/can1357/oh-my-pi) (see `NOTICE`). This
plugin is the Claude Code integration: an MCP server exposing `read`/`search`/`edit`,
and a hook that blocks the built-in editors so the model uses hashline.

## How it works

- **MCP server** (`src/server.ts`, run under Bun) exposes three tools,
  `mcp__plugin_claude-hashline_hashline__{read,search,edit}`.
  - `read` tags output and records a whole-file snapshot keyed by absolute path.
  - `search` regex-matches across the workspace and returns hits in the same
    tagged format, recording a snapshot for each matched file so the model can
    `edit` straight off a hit — no whole-file `read` first. Respects
    `.gitignore` by default; skips `node_modules`, dot-directories, and
    oversized files.
  - `edit` runs three gates the engine doesn't — **path containment** (edits
    can't escape the workspace), **read-before-edit** (you must `read` a file
    first), and **file creation** (a tagless `[path]` header creates a file) —
    then applies the patch via the engine, which rejects/recovers stale tags.
- **PreToolUse hook** (`hooks/`) denies built-in `Edit`/`Write`/`NotebookEdit`
  and redirects to the hashline tool — but only in projects that opt into
  enforcement (see Enforcement); off by default, so a global install is safe.

## Install

Requires **Bun ≥ 1.3.14**. From the plugin directory:

```bash
bun install
```

Add it as a local plugin in Claude Code. The MCP server is declared in
`.claude-plugin/plugin.json` (`mcpServers.hashline`) and the block + nudge hooks
in `hooks/hooks.json`. Safe to enable **globally** — see Enforcement.

## Enforcement (on by default)

The block hook is **on by default**: a globally enabled plugin denies the
built-in `Edit`/`Write`/`NotebookEdit` tools in every repo and redirects them to
the hashline edit tool. A `SessionStart` hook also nudges the model toward
`hashline__edit` up front, so it doesn't burn a turn reaching for a blocked
built-in.

Because this blocks editing everywhere, any repo where another tool or skill
relies on the built-in editors must **opt out** (see below).

## Opting out

To allow the built-in editors again, use any of:

- a `.hashline-off` marker file at the repo root (or any ancestor of the working
  directory) — committable, so a team excludes a repo by checking it in;
- `HASHLINE_DISABLED=1` in the environment (read fresh on every call) — the
  out-of-band recovery valve when the hashline edit tool itself is broken, since
  the in-session agent can't remove a marker while `Write` is blocked;
- `~/.hashline-off` — a HOME-trusted sentinel with the same recovery role.

**Security note.** A cwd/ancestor `.hashline-off` can be shipped in a cloned repo
or dropped by a prompt-injected agent (`touch .hashline-off`), silently disabling
the block. That is an accepted trade-off for per-repo opt-out: the block is a
workflow nudge, not a security boundary — the jailed MCP filesystem is the real
boundary. Don't rely on the block to contain a hostile model. For an opt-out that
repo contents can't spoof, use `~/.hashline-off` or `HASHLINE_DISABLED`.

## Jail carve-outs

The jailed filesystem normally confines every `read`/`edit`/`search` to the
workspace root (cwd or `HASHLINE_ROOT`). Three opt-in, additive carve-outs widen
it (all default-on in the published plugin, default-off in the library):

- **`HASHLINE_ALLOW_MEMORY=1`** — also allow any Claude Code per-project memory
  dir, `<configDir>/projects/<project>/memory/` and below, so the model can read
  and write its auto-memory through the hashline `edit` tool instead of falling
  back to a shell heredoc. `<configDir>` honors `CLAUDE_CONFIG_DIR` (default
  `~/.claude`). Scoped to the `.../projects/<slug>/memory/**` subtree only:
  session transcripts, settings, and everything else under `~/.claude` stay
  outside the jail.
- **`HASHLINE_ALLOW_TMP=1`** — also allow the system temp dir (`os.tmpdir()`,
  e.g. `/tmp` or macOS `/var/folders/...`) and below, for staging scratch files
  such as a PR body fed to `gh pr create --body-file`. The temp dir is
  ephemeral, world-writable scratch space, so the widening is bounded.
- **`HASHLINE_ALLOW_PATHS=dir1:dir2`** — also allow any path under each listed
  root (`path.delimiter`-separated, a leading `~/` expanded), e.g. a sibling
  repo or `~/.config`. The published plugin sets this to `~/.claude:~/.agents:~/.codex`
  so the model can edit its own agent config/skills. Roots are operator-supplied
  in the MCP env — unlike `.hashline-off`, repo contents can't inject one.
  **Note:** allowing all of `~/.claude` includes `settings.json` (whose hooks run
  shell commands), so a prompt-injected diff could reach it; the narrower
  `HASHLINE_ALLOW_MEMORY` exists precisely to avoid that. Trim the list if you
  don't need the whole tree.

Set a flag to `0`/unset (or empty `HASHLINE_ALLOW_PATHS`) to drop that carve-out;
edits are confined strictly to the workspace.

## Token savings tracker

A hashline edit avoids reproducing text a built-in edit would have emitted. The
honest alternative is `str_replace` — the old text plus the new text the model
would otherwise type — so the saving is the `old_string` you don't have to repeat,
not a whole-file `Write`. The plugin records that difference per edit into a
per-project, append-only ledger so you can see the running total. Large edits save
most; a tiny one-line edit can net ~zero, since the `[path#tag]` header and op line
are real output too.

```bash
bun run src/savings.ts            # rollup for the current project
# or, inside Claude Code:
/hashline-savings
```

- **On by default.** Opt out with `HASHLINE_TRACK_SAVINGS=0`.
- **Storage.** One JSONL file per project root under
  `<configDir>/hashline-savings/` (`CLAUDE_CONFIG_DIR`, default `~/.claude`;
  override with `HASHLINE_SAVINGS_DIR`). It lives outside your repo, so it never
  pollutes the tree. Writes are non-fatal — a ledger failure never breaks an edit.
- **Calibrated to the benchmark.** Measuring against `str_replace` keeps the total
  near the benchmark's real-world 9–21% range. Rows written before this baseline
  change are reported separately as legacy — they used an inflated full-`Write`
  baseline and can't be recomputed.
- **Estimates only.** Token counts use a `chars/4` heuristic. Anthropic ships no
  exact local tokenizer for current Claude models (the tokenizer changed with
  Opus 4.7), and the only ground truth — the `count_tokens` API or real-call
  `usage` fields — needs a network round-trip and auth, which a synchronous,
  offline edit path can't take. Treat the number as directional, not billable.

## Benchmark

Measures hashline vs. the built-in editor across Claude tiers (`bench/`).

```bash
# 1. generate fixtures from a source corpus (e.g. a React checkout)
bun run bench/generate.ts /path/to/react/packages out/fixtures --per-file 2

# 2. run both arms across models (requires the `claude` CLI on PATH)
bun run bench/run.ts out/fixtures \
  --models claude-haiku-4-5,claude-sonnet-4-6 \
  --arms hashline,control --max-turns 30 --out report.md
```

The runner drives the real `claude -p` headless CLI (`--output-format stream-json`),
loading the hashline MCP server per-run via `--mcp-config --strict-mcp-config` with
`HASHLINE_ROOT` pinned to each isolated workspace. The hashline arm blocks the
built-in editors with `--disallowedTools Edit Write NotebookEdit` (verified to be
enforced even under `--dangerously-skip-permissions`); a blocked attempt surfaces as
an errored `tool_result` and counts toward the edit-failure rate. Token counts and
turns come from the authoritative trailing `result` envelope.

The report stratifies pass rate, edit-failure rate, output tokens, and turns by
difficulty class (`simple` vs `hard-anchor`). Note the **confound**: the hashline
arm forces an unfamiliar tool while the control uses Claude's RL-tuned editor, so
a control-favoring result can't separate "hash format is worse" from "Claude
never saw these tool names" without the optional `familiarity` arm. The
formatter used for pass/fail is a deterministic placeholder — pin a real one
before drawing conclusions.

## Develop

```bash
bun test          # adapters, hook, benchmark core, diff-preview chaining
bun run typecheck
```

## Status

Phase 1 (plugin) is implemented and tested end-to-end: MCP handshake, read/edit
adapters, containment, stale-tag and read-before-edit gates, file creation, and
the block hook. Phase 2 (benchmark) is implemented; its deterministic parts
(mutation, scoring, aggregation, arm/flag mapping, transcript parsing) are
tested, and the live model run requires the `claude` CLI and a corpus. The full
pipeline (claude `-p` spawn, per-run MCP load, hashline read/edit, built-in
blocking, scoring, stratified report) has been validated end-to-end on a pilot
fixture across both arms. Grep tagging is deferred (`read` + `edit` only in v1);
the model falls back to built-in `Grep`.
