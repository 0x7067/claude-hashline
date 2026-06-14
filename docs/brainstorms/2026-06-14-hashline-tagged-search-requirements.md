# Tagged Search for the Hashline Plugin — Requirements

**Date:** 2026-06-14
**Status:** Ready for planning
**Scope:** Standard (feature-tier)

## Problem

The hashline plugin exposes only `read` and `edit`. To obtain the line tags an
edit needs, the model must `read` the whole file first — wasteful on large files
when the change is surgical. The reference post (*"I Improved 15 LLMs at Coding
in One Afternoon"*) describes the harness returning tagged lines not just on read
but on search: *"when the model reads a file, **or greps for something**, every
line comes back tagged."* That search affordance is the one true product gap
between the described harness and this plugin.

## Goal

Let the model find code by pattern and edit directly off a hit, without a
whole-file `read` to get line tags. Optimize for daily plugin usefulness, not
benchmark reproduction.

## Users / Actors

The coding model driving the hashline plugin inside Claude Code. Success is the
model issuing `search` → `edit` on a large file with no intervening `read`.

## Approach (selected)

**Edit-capable search with windowed context** (Approach C of three considered).

- Search returns matches grouped per file under the engine's `[PATH#TAG]`
  header, then `line:text` rows for each hit plus N lines of surrounding context
  — the same row shape `read` emits (this engine uses a whole-file `#TAG` and
  bare line numbers, not per-line hashes).
- Each matched file gets a recorded whole-file snapshot and `[PATH#TAG]` header,
  reusing the existing snapshot/TAG machinery, so the model can `edit` straight
  from results.
- The model sees only the windows (token-light), while the full snapshot is held
  server-side so anchored edits within shown lines are valid.

Rejected alternatives:
- **Navigation-only search** — returns tagged hits but still requires a separate
  `read` before editing; does not remove the whole-file read this feature exists
  to kill.
- **Edit-capable, full-context** — records snapshots but dumps too much tagged
  context, trading a read-cost for a search-cost.

## Requirements

1. A `search` MCP tool accepts a pattern and returns matches across the workspace.
2. Each match is rendered under its file's `[PATH#TAG]` header as `line:text`
   rows, with N lines of context on each side of the hit.
3. For every file that produced a match, the tool records a whole-file snapshot
   keyed by canonical absolute path and surfaces its `[PATH#TAG]` header — the
   same snapshot shape `read` records — so a subsequent `edit` passes the
   read-before-edit gate.
4. Search results provide an affordance to widen a window or fall back to `read`
   when the model needs lines outside the shown context.
5. Search respects the workspace jail: matches and recorded snapshots never
   escape the workspace root (canonical-path containment, as with `edit`).
6. The tool description steers the model to prefer `search` over built-in Grep
   for locate-then-edit work.

## Scope Boundaries

**In scope:** the `search` tool, windowed tag-anchored output, snapshot
recording on match, window-widening affordance, jail enforcement, steering
description.

**Deferred for later:**
- Benchmark-fidelity work (`apply_patch` arm, optional-chain / identifier-rename
  mutations, scale to ~180 tasks and more models). Deprioritized by the
  plugin-usefulness objective; tracked as a separate validation effort.
- Edit-result re-tagging to remove the forced re-read after each edit — the
  other daily friction, a logical follow-up once search lands.
- Blocking built-in Grep/Glob via hook. Revisit only if adoption measurement
  shows the model ignoring `search`.

## Success Criteria

- The model completes a `search` → `edit` sequence on a large file with zero
  intervening `read` calls.
- Edits anchored on lines shown in a search window apply without a stale-tag
  rejection.
- Context emitted per search is materially smaller than a whole-file read for the
  same edit.

## Dependencies / Assumptions

- **Resolved (spike, 2026-06-14):** `@oh-my-pi/hashline` v15.12.4 exposes **no**
  search/grep primitive — its modules are the patch language only (`apply`,
  `patcher`, `parser`, `snapshots`, `format`, `recovery`, …). Search must be
  **built in the adapter** over ripgrep/Bun. The tagging half is reusable: the
  package exports `formatHashlineHeader` and the snapshot store, both already
  used by the `read` adapter — only file-walk + pattern-match is net-new.
- Reuses the existing `InMemorySnapshotStore`, `JailedFilesystem`, and
  `formatHashlineHeader`; no new concurrency model.
- No hook change required for v1 (built-in Grep stays available; steering is via
  tool description).

## Outstanding Questions

- Default context window size (N lines) and caps on matches / total output.
- Whether an `edit` citing a line the model did **not** see in any window should
  be allowed, warned, or rejected.
- Whether `search` should record snapshots for every matched file eagerly, or
  only on demand to bound snapshot-store growth on broad searches.

## Reference

- Source post: `~/Downloads/I Improved 15 LLMs at Coding in One Afternoon. Only the Harness Changed..md`
- Current tools: `src/server.ts` (`read`/`edit`), `src/core.ts` (snapshot + gates)
- Hook scope: `hooks/hooks.json` (blocks `Edit|Write|NotebookEdit` only)
