---
title: "feat: search-mode benchmark arm — make tasks exercise hashline search"
date: 2026-06-14
type: feat
origin: docs/plans/2026-06-14-001-feat-hashline-tagged-search-plan.md
depth: standard
---

# feat: search-mode benchmark — make tasks exercise hashline `search`

## Summary

The benchmark tasks name the target file (`File: jitter.ts`, `near line 8`), so
the model reads+edits and never searches. This adds a `--search` mode that
withholds the path, drops the target file into a **multi-file workspace** with
distractors, and points the model at a searchable **anchor** — forcing a
locate-then-edit loop. In the hashline arm, built-in `Grep`/`Glob`/`Read` are
disallowed so the model must use `mcp__hashline__search`; the control arm uses
built-in `Grep`. A new per-task **search-call count** proves search was used.

## Problem Frame

`bench/run.ts` writes one file (`fx.targetName`) into the workspace and passes a
task that names it. Nothing requires search. We need a mode where finding the
file is part of the task, and a metric that confirms the search tool fired.

## Key Technical Decisions

1. **Search-mode is a run-level flag, not a new arm.** Arms select the *edit*
   toolset; search-mode changes *task framing* (workspace + prompt + which
   navigation tools are allowed). It composes with the existing `hashline` /
   `control` arms.
2. **Anchor derived at runtime from the expected file + `meta.line`.** No fixture
   regeneration. Pick a stable identifier near the mutated line as the search
   handle; guarantee distractors don't contain it.
3. **Hashline arm in search-mode disallows `Read`/`Grep`/`Glob`** (plus the
   existing `Edit`/`Write`/`NotebookEdit`), forcing the full hashline loop
   (`search` → `read` → `edit`). Control keeps built-ins.
4. **Pure helpers live in `bench/search-mode.ts`** (anchor, prompt rewrite,
   distractor selection) so they are unit-testable without the `claude` CLI.
5. **`searchCalls` metric** counts `tool_use` blocks named
   `mcp__hashline__search`, `Grep`, or `Glob`, threaded runner → score → report.

## Implementation Units

### U1. Pure search-mode helpers (`bench/search-mode.ts`)
**Files:** `bench/search-mode.ts` (new), `test/bench.test.ts`.
**Approach:**
- `computeAnchor(expected: string, line: number): string` — scan a small window
  around `line` for a declaration/identifier (`function|const|let|var|class NAME`,
  else longest ≥4-char identifier), skipping keywords.
- `buildSearchPrompt(task: string, anchor: string): string` — strip `File:` lines
  and `on/near line N` phrases; prepend the multi-file locate instruction; append
  a `search for \`<anchor>\`` hint.
- `pickDistractors(others, k, anchor)` — choose up to k other fixtures' buggy
  files, dedup by name, exclude any containing the anchor.
**Test scenarios:** anchor picks the function name for a removed-guard fixture;
prompt no longer contains the filename or line number but keeps the description;
distractors exclude anchor-containing files and dedup names.

### U2. `searchCalls` transcript metric (`bench/runner.ts`)
**Files:** `bench/runner.ts`, `test/bench.test.ts`.
**Approach:** add `searchCalls` to `TranscriptMetrics`; count `tool_use` blocks
named `mcp__hashline__search`/`Grep`/`Glob` per assistant message. Extend
`disallowedToolsFor(arm, searchMode)` to add `Read`/`Grep`/`Glob` for the
hashline/familiarity arms when `searchMode`.
**Test scenarios:** a synthetic transcript with two search tool_use blocks yields
`searchCalls === 2`; `disallowedToolsFor("hashline", true)` includes `Grep`.

### U3. Wire search-mode into the runner (`bench/run.ts`)
**Files:** `bench/run.ts`.
**Approach:** parse `--search`; when set, for each fixture write target +
distractors, compute the anchor, build the search prompt, and pass
`searchMode` to `disallowedToolsFor`. Populate `RunRecord.searchCalls`.
**Test expectation:** none -- integration wiring; covered by the smoke run.

### U4. Thread `searchCalls` to the report (`bench/score.ts`, `bench/report.ts`)
**Files:** `bench/score.ts`, `bench/report.ts`.
**Approach:** add `searchCalls` to `RunRecord`, `meanSearchCalls` to `Cell` +
`summarize`, and a `search/task` column to the report table.
**Test expectation:** none -- mechanical; covered by U1/U2 + smoke.

## Scope Boundaries

**In scope:** `--search` mode, anchor/distractor/prompt helpers, hashline-arm
navigation lockdown, search-call metric + report column.

### Deferred to Follow-Up Work
- Per-fixture curated anchors (vs. derived) if derived anchors prove ambiguous.
- A "located the right file" correctness signal beyond pass/fail.

## Validation

Unit-test the pure helpers and the metric. Then a search-mode smoke (1 fixture,
1 model, both arms) must show `searchCalls ≥ 1` for the hashline arm. Finally run
the full search-mode benchmark and write a second report alongside the
regression report.
