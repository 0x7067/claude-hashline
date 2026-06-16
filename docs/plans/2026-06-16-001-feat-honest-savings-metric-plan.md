---
title: "feat: Honest savings metric (str_replace baseline)"
date: 2026-06-16
type: feat
origin: docs/brainstorms/2026-06-16-honest-savings-metric-requirements.md
---

# feat: Honest savings metric (str_replace baseline)

## Summary

Re-baseline the hashline savings ledger from a full-file `Write` counterfactual to the realistic `str_replace` one, so the reported saving reflects the benchmark's measured 9–21% instead of the current ~95%. The per-edit estimate is computed from the `before`/`after` the patch engine already returns, isolating the changed region with a dependency-free prefix/suffix line-trim. Ships with a rollup that separates honest new rows from un-recomputable legacy rows, and README copy that drops the full-Write claim.

## Problem Frame

The ledger reports `est(after) − est(input)` (`src/savings.ts`), assuming every edit's alternative is rewriting the whole file. The model's real alternative is `str_replace` (old text + new text), so the headline overstates by ~the file size — this project's rollup says 95% while the benchmark measured 9–21% (`docs/benchmark/analysis.md`). Full rationale in the origin doc (see origin: `docs/brainstorms/2026-06-16-honest-savings-metric-requirements.md`).

## Key Technical Decisions

- KTD1. **str_replace counterfactual via prefix/suffix line-trim.** Split `before`/`after` into lines, drop the common leading and trailing lines, and the remainder is the changed region on each side. `baseline = est(oldChanged) + est(newChanged)`; `saved = baseline − est(input)`. Contiguous and dependency-free — hashline ops are contiguous ranges, so no diff library is needed.
- KTD2. **Source `before`/`after` from the patch result, not a re-read.** `PatchSectionResult` already exposes `before` and `after` per section (`node_modules/@oh-my-pi/hashline/dist/types/patcher.d.ts`). This dissolves the origin doc's "derive the before-range per op" planning question — the engine hands it over directly, so the edit path needs no extra read and no snapshot threading.
- KTD3. **Version ledger rows to `v: 2`; separate legacy in the rollup.** Existing `v: 1` rows store only counts (no `before`), so they cannot be recomputed. New rows are `v: 2` with the str_replace baseline; the rollup reports v2 as the headline and v1 under a labeled "legacy (inflated full-Write baseline)" line — never summed together.
- KTD4. **chars/4 estimator unchanged.** The honesty bug is the baseline, not the estimator; an exact tokenizer can't run on the offline edit path. Figures stay directional.

## Requirements Traceability

- R1, R2, R3 → U1 (per-edit computation)
- R7 → U1 (row versioning)
- R4, R5, R8 → U2 (rollup output)
- R6 → U3 (README)

---

## Implementation Units

### U1. Re-baseline the per-edit saving computation

- **Goal:** Compute each edit's saving against the `str_replace` counterfactual from the engine's `before`/`after`, and stamp rows `v: 2`.
- **Requirements:** R1, R2, R3, R7.
- **Dependencies:** none.
- **Files:** `src/savings.ts`, `src/core.ts`, `test/savings.test.ts`.
- **Approach:**
  - In `src/savings.ts`, change `recordEditSaving` to receive per-section `{ before, after }` instead of `afters: string[]`. Compute `baselineTokens` by summing, per changed section, `est(oldChanged) + est(newChanged)` where `oldChanged`/`newChanged` come from the prefix/suffix line-trim (KTD1). Keep `patchTokens = est(input)`; `savedTokens = baselineTokens − patchTokens`. Rename the `fullWriteTokens` field to `baselineTokens` and bump `LedgerRow.v` to `2`.
  - In `src/core.ts`, the main edit path passes `result.sections.filter(s => s.op !== "noop")` (each carries `before`/`after`) into `recordEditSaving`. The create path (`handleCreates`) passes sections with `before: ""` so a create's baseline is the full body and `savedTokens ≈ 0` (str_replace cannot create — Write is its only counterfactual).
  - Preserve the non-fatal contract: the computation and ledger write never throw into the edit path.
- **Patterns to follow:** existing `recordEditSaving`/`estimateTokens` shape in `src/savings.ts`; existing call sites at `src/core.ts` (main path ~`recordEditSaving(...)` after `patcher.apply`, and in `handleCreates`).
- **Execution note:** Tests come straight from the origin acceptance examples — write them first.
- **Test scenarios:**
  - Covers AE1 / R1. Replace 2 lines inside a ~500-line `before`; assert `savedTokens ≈ est(the 2 old lines)`, an order of magnitude below `est(after)`.
  - Covers AE2 / R2. Pure insert (before/after share all lines but the inserted ones); `oldChanged` is empty, so `savedTokens ≈ 0`.
  - Covers AE3 / R2. Delete a 5-line span with a tiny `delete N..M` patch; `savedTokens ≈ est(deleted text)`.
  - R2. Create section (`before: ""`); `savedTokens ≈ 0`.
  - Edge: multi-section / multi-hunk edit — trim spans all changes, `savedTokens` is positive and finite, no crash.
  - R7. Written row has `v: 2` and a `baselineTokens` field.
  - R3. A forced ledger-write failure is swallowed and the edit still returns success (mirror the existing non-fatal test).
- **Verification:** `bun test test/savings.test.ts` green; `bun run typecheck` clean (both call sites updated to the new signature).

### U2. Honest rollup: headline vs labeled legacy

- **Goal:** Report v2 rows as the headline saving and v1 rows under a separate labeled line, drop the full-Write framing, and add a benchmark-calibration line.
- **Requirements:** R4, R5, R8.
- **Dependencies:** U1 (defines `v: 2` rows and the `baselineTokens` field).
- **Files:** `src/savings.ts`, `test/savings.test.ts`.
- **Approach:**
  - In `readRollup`, accumulate v2 rows into the headline rollup and v1 rows into a separate legacy rollup (carry both in the returned shape).
  - In `formatRollup`, label the headline baseline as the realistic built-in editor (`str_replace`), render the legacy line as "legacy (inflated full-Write baseline)" only when legacy rows exist, and add a calibration line noting the benchmark's measured 9–21% range alongside the existing chars/4 caveat. The two baselines are never folded into one total.
- **Patterns to follow:** existing `Rollup`/`readRollup`/`formatRollup` in `src/savings.ts`.
- **Test scenarios:**
  - R8. Mixed ledger (v1 + v2 rows): headline sums v2 only; legacy line reflects v1 only; totals are not combined.
  - R4 / R5. `formatRollup` output contains the `str_replace` baseline label and the benchmark-calibration line.
  - R8. Ledger with no v1 rows: no legacy line rendered.
  - Edge: empty/missing ledger → all zeros, no legacy line, no crash (preserve current behavior).
- **Verification:** `bun test test/savings.test.ts` green; `/hashline-savings` (or `bun run src/savings.ts`) on this repo shows a headline near the benchmark range plus a labeled legacy line for the 8 existing rows.

### U3. README copy

- **Goal:** Stop asserting hashline replaces a full-file `Write`; describe the `str_replace` baseline.
- **Requirements:** R6.
- **Dependencies:** none (can land independently; content matches U1/U2 behavior).
- **Files:** `README.md`.
- **Approach:** In the "Token savings tracker" section (`README.md`), replace the "Every hashline edit replaces a full-file `Write`…" framing with the `str_replace` baseline ("hashline saves the old text you don't have to reproduce"), and note the rollup separates legacy rows. Keep the existing estimate/caveat paragraph.
- **Test expectation:** none — documentation copy.
- **Verification:** the README no longer contains "replaces a full-file Write"; the savings section matches the rollup's new wording.

---

## Out of Scope (from origin)

Carried from the requirements doc as explicit non-goals: counting failed/rejected edits (net-of-retry honesty), replacing chars/4 with an exact tokenizer, trimming the tool's own input overhead (edit-result window, search context, descriptions), and squeezing more per-edit output savings.

## Risks & Notes

- **Multi-hunk edits slightly overcount.** A prefix/suffix trim collapses to the single span covering all hunks in a file, so a file with two far-apart edits counts the lines between them as changed. This inflates `baseline` modestly — directional, acceptable, and `str_replace` for scattered edits would be multiple calls anyway. Note it in a code comment rather than reaching for a real diff.
- **Legacy rows stay on disk.** They are not migrated or deleted, only reported separately; the ledger file remains append-only.
- **No external consumers.** The `v: 2` row schema is read only by `readRollup` in this repo, so the bump is self-contained.
