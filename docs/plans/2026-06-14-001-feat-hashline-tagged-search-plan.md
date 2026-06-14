---
title: "feat: Tagged search for the hashline plugin"
date: 2026-06-14
type: feat
origin: docs/brainstorms/2026-06-14-hashline-tagged-search-requirements.md
depth: standard
---

# feat: Tagged Search for the Hashline Plugin

## Summary

Add a third MCP tool, `search`, to the hashline plugin. It matches a pattern
across the workspace and returns hits grouped per file under the engine's
`[PATH#TAG]` header with windowed `line:text` rows. Critically, it records a
whole-file snapshot for every matched file — the same snapshot `read` records —
so the model can `edit` directly off a search hit, eliminating the whole-file
`read` currently needed just to obtain line tags.

Scoped to plugin usefulness. Benchmark-fidelity work, edit-result re-tagging, and
Grep-blocking are explicitly deferred (see origin Scope Boundaries).

---

## Problem Frame

The plugin exposes only `read` and `edit` (`src/server.ts`). The edit gate
refuses any edit to a file with no recorded snapshot (`src/core.ts:147`), so to
edit, the model must first `read` the entire file. On large files with surgical
edits this wastes context. The reference post describes the harness tagging lines
on search too — *"when the model reads a file, or greps for something, every line
comes back tagged"* (see origin). That search affordance is the gap.

The spike (origin Dependencies) resolved feasibility: `@oh-my-pi/hashline`
v15.12.4 has **no** search primitive, but exports the tagging pieces
(`formatHashlineHeader`, `formatNumberedLines`, the snapshot store) the `read`
adapter already uses. Only file-walk + match is net-new.

---

## Requirements Traceability

Carried from origin (`*-requirements.md`):

- R1 — `search` MCP tool accepting a pattern → **U2**, **U1**
- R2 — per-file `[PATH#TAG]` header + windowed `line:text` rows → **U1**
- R3 — record whole-file snapshot for matched files (edit-without-read) → **U1**
- R4 — affordance to widen window / fall back to `read` → **U1** (tail hint), **U2** (description)
- R5 — workspace-jail containment for matches and snapshots → **U1**
- R6 — description steers the model to prefer `search` over built-in Grep → **U2**

---

## Key Technical Decisions

1. **In-process TS walk, not ripgrep.** v1 walks the tree in-process (skipping
   `node_modules` and dot-dirs, mirroring `bench/generate.ts` `walk`) and regex-
   matches per line. Avoids an external `rg` dependency and keeps every path
   inside `JailedFilesystem`. ripgrep is a future optimization, not v1.
   *Rationale:* no new dependency; containment is already solved for in-process
   FS access; workspace-scale walks are acceptable for v1 with caps.

2. **Snapshot recording is eager but match-gated.** Record a snapshot
   (`ctx.snapshots.record(key, normalized)`) only for files with ≥1 match, not
   every walked file. Bounds snapshot-store growth on broad searches (resolves
   origin open question 3).

3. **Edits citing un-shown lines are allowed, no new gate.** The recorded
   snapshot covers the whole file, so the TAG validates any correctly-cited line;
   the engine's existing stale-tag / line-range validation governs. The model is
   told to `read` when it needs lines outside a window. (Resolves origin open
   question 2.)

4. **Window N=2 lines each side; overlapping windows merge.** Mirrors the
   package's `MISMATCH_CONTEXT = 2`. Hits closer than 2N collapse into one
   contiguous window per file so rows are never duplicated.

5. **Caps with a truncation tail.** Bound max matched files, max matches, and
   max total emitted lines; when exceeded, emit a `... N more match(es); narrow
   your pattern` tail mirroring `read`'s overflow tail (`src/core.ts:91`).

6. **No hook change in v1.** Built-in Grep stays available; steering is via the
   tool description only (origin deferred scope).

---

## Implementation Units

### U1. Core search adapter (`hashlineSearch`)

**Goal:** A pure adapter function that walks the jailed workspace, matches a
pattern, records snapshots for matched files, and renders windowed tagged output.

**Requirements:** R1, R2, R3, R4, R5.

**Dependencies:** none (builds on existing `HashlineContext`).

**Files:**
- `src/core.ts` — add `hashlineSearch(ctx, args)` plus `SearchArgs` and internal
  helpers (tree walk, per-file window merge, output render).
- `test/core.test.ts` — add a `describe("hashlineSearch")` block.

**Approach:**
- Signature: `hashlineSearch(ctx, { pattern, flags?, maxResults? })` returning a
  string (same shape contract as `hashlineRead`).
- Walk from `ctx.root` using a `node_modules`/dot-dir-skipping recursion; for each
  file resolve via `ctx.fs.canonicalPath` so containment holds (R5).
- Read + `normalizeToLF(stripBom(...).text)` (matching `hashlineRead` at
  `src/core.ts:78`); compile the pattern as a `RegExp` per line.
- For files with ≥1 match: `ctx.snapshots.record(key, normalized)` to obtain the
  TAG and satisfy the read-before-edit gate (R3); compute merged windows (KTD4);
  render `formatHashlineHeader(relPath, hash)` + `formatNumberedLines(slice,
  windowStart)` per window.
- Apply caps (KTD5) and emit the truncation tail (R4).
- Reject nothing on zero matches — return a `no matches for /pattern/` string so
  the probe self-corrects (mirrors the directory-listing affordance at
  `src/core.ts:74`).

**Patterns to follow:** `hashlineRead` (`src/core.ts:63`) for normalize +
record + header/body assembly; `walk` in `bench/generate.ts` for the skip-list
recursion.

**Test scenarios** (in `test/core.test.ts`):
- Happy path: a pattern matching two files returns both, each under its own
  `[rel#TAG]` header with `line:text` rows including ±2 context. *(Covers R2.)*
- Edit-without-read: after `hashlineSearch`, a `hashlineEdit` anchored on a
  shown line applies successfully with **no** prior `hashlineRead`. *(Covers R3 —
  the core value.)*
- Window merge: two hits 1 line apart in one file render as a single contiguous
  window, no duplicated rows. *(Covers KTD4.)*
- Caps: with `maxResults` exceeded, output stops at the cap and ends with the
  `... N more match(es)` tail. *(Covers R4/KTD5.)*
- Jail: a workspace containing a symlink pointing outside the root never emits
  rows or records a snapshot for the out-of-root target. *(Covers R5 — mirror the
  existing `PathEscapeError` symlink test in `test/core.test.ts`.)*
- Zero matches: an unmatched pattern returns the `no matches` string, not an
  error throw.
- Snapshot scoping: a walked-but-unmatched file has `ctx.snapshots.head(key)
  === null` afterward (only matched files are recorded). *(Covers KTD2.)*

**Verification:** `bun test` green; the edit-without-read scenario proves the
friction is removed.

---

### U2. Register the `search` MCP tool and its description

**Goal:** Expose `hashlineSearch` over MCP and steer the model toward it.

**Requirements:** R1, R4, R6.

**Dependencies:** U1.

**Files:**
- `src/descriptions.ts` — add `SEARCH_TOOL_DESCRIPTION`.
- `src/server.ts` — `server.registerTool("search", …)` wired to `hashlineSearch`,
  mirroring the `read` registration (`src/server.ts:18`).

**Approach:**
- Input schema: `pattern: string` (required), optional `flags` (e.g. `i`) and
  `maxResults: number`. Same try/catch-to-`isError` envelope as `read`
  (`src/server.ts:28`).
- Description (KTD6/R6): state that `search` returns the same `[PATH#TAG]` +
  `line:text` shape as `read`, that the model can `edit` directly off a hit
  without re-reading, and that it should prefer `search` over built-in Grep when
  the goal is locate-then-edit. Include the widen-window / `read`-for-more
  affordance (R4). Follow the prose economy of `READ_TOOL_DESCRIPTION`.

**Patterns to follow:** `READ_TOOL_DESCRIPTION` (`src/descriptions.ts:8`) and the
`read` tool registration block (`src/server.ts:18`).

**Test scenarios:**
- `test/hook.test.ts` is unaffected (no hook change). If a server-level smoke
  test exists for tool registration, assert `search` is registered; otherwise
  `Test expectation: none -- thin MCP wiring over U1, behavior covered by U1.`

**Verification:** server starts under Bun; `search` appears as
`mcp__plugin_claude-hashline_hashline__search`; a manual `search` → `edit`
round-trip on a large file completes with no `read`.

---

## Scope Boundaries

**In scope:** the `search` tool, windowed tagged output, match-gated snapshot
recording, window merge + caps, jail enforcement, steering description.

### Deferred for later (from origin)
- Benchmark-fidelity work (`apply_patch` arm, optional-chain / identifier-rename
  mutations, scale to ~180 tasks and more models).
- Edit-result re-tagging to remove the forced re-read after each edit.
- Blocking built-in Grep/Glob via hook — revisit after measuring adoption.

### Deferred to Follow-Up Work (plan-local)
- ripgrep-backed walk as a performance optimization once correctness is proven.
- Pagination/`offset` for `search` if cap-truncation proves too blunt in use.

---

## Risks & Dependencies

- **Walk performance on large repos.** In-process walk + per-line regex could be
  slow on big trees. Mitigation: skip-list (`node_modules`, dot-dirs) + caps
  (KTD5); ripgrep deferred as the optimization path if needed.
- **Binary/huge files.** A naive walk may try to read binaries. Mitigation: skip
  files that fail UTF-8 normalization or exceed a size ceiling; treat as a U1
  edge case (add a scenario if the walk surfaces it).
- **Adoption.** Without a hook block, the model may keep using built-in Grep. The
  description is the only lever in v1; adoption is the signal that decides whether
  to revisit Grep-blocking (origin deferred item).

---

## Open Questions (deferred to implementation)

- Exact cap values (max files / matches / total lines) — pick conservative
  defaults in U1, tune against real use.
- Whether `flags` should be a typed enum or a raw regex-flags string — settle when
  writing the U2 schema.
