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

## Claude memory carve-out

The jailed filesystem normally confines every `read`/`edit`/`search` to the
workspace root (cwd or `HASHLINE_ROOT`). When `HASHLINE_ALLOW_MEMORY=1` (the
default in the published plugin), the jail **additionally** allows any Claude
Code per-project memory dir — `<configDir>/projects/<project>/memory/` and below
— so the model can read and write its auto-memory through the hashline `edit`
tool instead of falling back to a shell heredoc. `<configDir>` honors
`CLAUDE_CONFIG_DIR` (default `~/.claude`). The carve-out is scoped to the
`.../projects/<slug>/memory/**` subtree only: session transcripts, settings, and
everything else under `~/.claude` remain outside the jail and are not writable.
Set `HASHLINE_ALLOW_MEMORY=0` (or unset it) to confine edits strictly to the
workspace.

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
