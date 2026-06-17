# claude-hashline

Replaces `str_replace`-style editing in Claude Code with **hashline**: a
line-anchored patch language. Instead of reproducing exact old text (and hitting
"String to replace not found" retry loops), the model reads a file tagged with a
whole-file content hash and edits by line number.

```
[src/app.ts#9A46]          [src/app.ts#9A46]
1:export function hello() {   replace 2..2:
2:  return "world";          +  return "hashline";
3:}
```

The patch engine is the MIT-licensed
[`@oh-my-pi/hashline`](https://github.com/can1357/oh-my-pi) (see `NOTICE`). This
plugin is the Claude Code integration: an MCP server exposing `read`/`search`/`edit`,
plus a hook that blocks the built-in editors so the model uses hashline.

Background on why line-anchored editing beats string replacement:
[The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/).

## How it works

- **MCP server** (`src/server.ts`, run under Bun) exposes three tools:
  - `read` — tags output and snapshots the file by absolute path.
  - `search` — regex across the workspace, returning tagged hits you can `edit`
    straight off (no whole-file `read` first). Respects `.gitignore`; skips
    `node_modules`, dot-dirs, and oversized files.
  - `edit` — adds three gates over the engine: path containment (can't escape the
    workspace), read-before-edit, and file creation (a tagless `[path]` header
    creates a file). Stale tags are rejected/recovered by the engine.
- **PreToolUse hook** (`hooks/`) denies built-in `Edit`/`Write`/`NotebookEdit`
  and redirects to hashline. A `SessionStart` hook nudges the model up front so
  it doesn't waste a turn on a blocked built-in.

## Install

Requires **Bun ≥ 1.3.14** on `PATH`. Inside Claude Code, add the marketplace
from GitHub and install:

```
/plugin marketplace add 0x7067/claude-hashline
/plugin install claude-hashline@hashline-dev
```

Restart when prompted. Bun auto-installs the server's deps on first launch, so
there's nothing else to run. Verify the MCP server is up with `/mcp` (look for
`hashline`) and that the built-in editors are blocked — `Edit`/`Write` should be
denied with a redirect to `hashline__edit`.

The MCP server and hooks are declared in `.claude-plugin/plugin.json` and
`hooks/hooks.json`. Safe to enable globally.

## Opting out

Enforcement is on by default and blocks editing everywhere, so any repo relying
on the built-in editors must opt out via any of:

- **`.hashline-off`** marker at the repo root or any ancestor — committable, so a
  team can exclude a repo by checking it in.
- **`HASHLINE_DISABLED=1`** in the environment — the recovery valve when the
  hashline edit tool itself is broken (the agent can't remove a marker while
  `Write` is blocked).
- **`~/.hashline-off`** — a HOME-trusted sentinel with the same recovery role.

The block is a workflow nudge, not a security boundary — a `.hashline-off` can be
shipped in a cloned repo or dropped by a prompt-injected agent. The jailed MCP
filesystem is the real boundary. For an opt-out repo contents can't spoof, use
`~/.hashline-off` or `HASHLINE_DISABLED`.

## Jail carve-outs

The jail confines `read`/`edit`/`search` to the workspace root (cwd or
`HASHLINE_ROOT`). Four opt-in flags widen it (all default-on in the plugin):

- **`HASHLINE_ALLOW_MEMORY=1`** — also allow the per-project memory dir,
  `<configDir>/projects/<slug>/memory/**`, so the model can edit its auto-memory.
  `<configDir>` honors `CLAUDE_CONFIG_DIR` (default `~/.claude`). Scoped to that
  subtree only — transcripts and settings stay out.
- **`HASHLINE_ALLOW_PLANS=1`** — also allow the plans dir, `<configDir>/plans/**`,
  so the model can write plan files. `<configDir>` honors `CLAUDE_CONFIG_DIR`
  (default `~/.claude`).
- **`HASHLINE_ALLOW_TMP=1`** — also allow the system temp dir (`os.tmpdir()`) for
  staging scratch files, e.g. a PR body for `gh pr create --body-file`.
- **`HASHLINE_ALLOW_PATHS=dir1:dir2`** — also allow each listed root (`:` on
  macOS/Linux, `;` on Windows; leading `~/` expanded). Operator-supplied in the
  MCP env, so repo contents can't inject one. Allowing all of `~/.claude` exposes
  `settings.json` (whose hooks run shell commands) — prefer the narrower
  `HASHLINE_ALLOW_MEMORY`.

Set a flag to `0`/unset to drop the carve-out.

## Token savings tracker

Each hashline edit avoids reproducing the `old_string` a `str_replace` would
emit. The plugin records that saving per edit into a per-project append-only
ledger. Large edits save most; a tiny one-liner can net ~zero (the `[path#tag]`
header and op line are real output too).

```bash
bun run src/savings.ts      # rollup for the current project
/hashline-savings           # or, inside Claude Code
```

- **On by default.** Opt out with `HASHLINE_TRACK_SAVINGS=0`.
- **Storage.** One JSONL per project under `<configDir>/hashline-savings/`
  (override with `HASHLINE_SAVINGS_DIR`). Lives outside your repo. Writes are
  non-fatal — a ledger failure never breaks an edit.
- **Estimates only.** Token counts use a `chars/4` heuristic (no exact local
  tokenizer ships for current Claude models). Directional, not billable.

## Benchmark

Measures hashline vs. the built-in editor across Claude tiers (`bench/`).

```bash
# 1. generate fixtures from a source corpus
bun run bench/generate.ts /path/to/react/packages out/fixtures --per-file 2

# 2. run both arms across models (requires the `claude` CLI on PATH)
bun run bench/run.ts out/fixtures \
  --models claude-haiku-4-5,claude-sonnet-4-6 \
  --arms hashline,control --max-turns 30 --out report.md
```

The runner drives the real `claude -p` headless CLI, loading the MCP server
per-run with `HASHLINE_ROOT` pinned to each isolated workspace. The hashline arm
blocks the built-in editors via `--disallowedTools`; a blocked attempt counts
toward the edit-failure rate. The report stratifies pass rate, edit-failure rate,
output tokens, and turns by difficulty (`simple` vs `hard-anchor`).

**Confound:** the hashline arm forces an unfamiliar tool while the control uses
Claude's RL-tuned editor, so a control-favoring result can't separate "hash
format is worse" from "Claude never saw these tool names" without the optional
`familiarity` arm. The pass/fail formatter is a deterministic placeholder — pin a
real one before drawing conclusions.

## Develop

```bash
bun test          # adapters, hook, benchmark core, diff-preview chaining
bun run typecheck
```
