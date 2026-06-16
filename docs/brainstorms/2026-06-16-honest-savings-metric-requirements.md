---
date: 2026-06-16
topic: honest-savings-metric
---

# Honest savings metric — requirements

## Summary

Re-baseline the hashline savings ledger against the realistic built-in alternative — `str_replace` (old text + new text) — instead of a full-file `Write`. The per-edit saving becomes "the old text you didn't have to reproduce," which lands near the benchmark's measured 9–21%, not the current ~95%. Ships with copy fixes that stop claiming hashline replaces a full Write, and a calibration line on the rollup.

## Problem Frame

The ledger sells a number that isn't real. This project's own rollup reports **~95% fewer output tokens** (8 edits, 33,476 "full-write" tokens → 1,655 emitted), while the benchmark — measured against the actual built-in editor across two models — found **9–21%** (`docs/benchmark/analysis.md`). The ~5× gap has one cause: the per-edit saving is `est(after) − est(input)` (`src/savings.ts`), i.e. it assumes the alternative to every edit is rewriting the whole file with `Write`. The README states it outright: "Every hashline edit replaces a full-file Write" (`README.md`).

But the model's real alternative to a small edit is `str_replace`, which emits only the changed region (old + new), not the whole file. Measuring against full-Write compares hashline to a strawman nobody would run, so the headline overstates by roughly the size of the file. Hashline's genuine edge over `str_replace` is real but modest — it's the `old_string` you don't have to reproduce (exactly the retry-loop pain it was built to remove) — and the metric should report that, not the strawman delta.

## Key Decisions

- **str_replace baseline over full-Write.** Measure the saving against what the model would actually have typed, not against a blind whole-file rewrite. This is the entire honesty fix.
- **Keep the chars/4 estimator.** The honesty bug is the baseline, not the estimator. An exact tokenizer needs a network round-trip the offline edit path can't take; chars/4 stays, with its existing "directional, not billable" caveat.
- **Keep the ledger wins-only for now.** Failed/rejected edits cost a round-trip and are invisible today (recording only fires on success). Net-of-retry accounting is deferred — failures are rare (5/24 sessions) and the baseline is the bigger lie.
- **Don't rewrite history.** Existing rows store only token counts, not the `before` text, so they cannot be re-baselined. Version the row schema and report new rows honestly rather than silently mixing two baselines.

## Requirements

**Metric correctness**

- R1. The per-edit saving is computed against a `str_replace` counterfactual — `est(old_string)` (the before-text in the replaced range) plus `est(new_string)` (the emitted body) — minus the patch the model actually emitted.
- R2. For operations where `str_replace` would emit little or nothing, the recorded saving trends to ~0 rather than the full `after`: a pure `insert` has a near-empty `old_string`; a file create emits the full body either way (saving ~0, as today).
- R3. The computation reuses the before-file snapshot the edit already loaded — no extra file read on the edit path, and tracking stays non-fatal (a failure never breaks an edit).

**Reporting honesty**

- R4. The rollup output drops the "what Write would have emitted" framing and labels the baseline as the realistic built-in editor (`str_replace`).
- R5. The rollup carries a calibration line tying the estimate to the benchmark's measured 9–21% range, alongside the existing chars/4 caveat.
- R6. The README stops asserting hashline "replaces a full-file Write"; its savings section reflects the `str_replace` baseline.
- R7. New-baseline rows are distinguishable from legacy full-Write rows (a schema version bump) so a rollup never silently sums two different baselines.
- R8. The rollup reports new-baseline rows as the headline total and shows legacy full-Write rows under a separate, clearly-labeled "legacy (inflated full-Write baseline)" line — never folding the two baselines into one total.

## Acceptance Examples

- AE1. **Covers R1.** Replace 2 lines inside a 500-line file. **Given** the before-region is ~2 lines and the model typed a ~2-line patch, **then** the saving ≈ `est(2 old lines)`, a small positive number — not ~500 lines.
- AE2. **Covers R2.** Insert a line after line 40. **Given** `str_replace` would emit a near-empty `old_string`, **then** the recorded saving is ~0, not the size of the surrounding file.
- AE3. **Covers R2.** Delete lines 10..14. **Given** hashline emits only `delete 10..14` while `str_replace` would emit the deleted text as `old_string`, **then** the saving ≈ `est(deleted text)`.

## Scope Boundaries

- Counting failed/rejected edits (net-of-retry honesty) — deferred.
- Replacing chars/4 with an exact tokenizer — out; the estimator isn't the bug.
- Trimming the tool's own input overhead (edit-result window, search context, ~1k-token descriptions) — a different surface, not this brainstorm.
- Squeezing more per-edit output savings — diminishing; the thesis already wins.

## Outstanding Questions

**Deferred to planning**

- How the changed before-range is derived per op (`replace`/`delete`/`insert`) from the patch result and snapshot — an implementation detail for ce-plan, given the before snapshot is already in hand.

## Dependencies / Assumptions

- The before-file snapshot is available at save time (the edit loaded it to validate the tag), so the `old_string` estimate needs no extra read. ce-plan confirms how to surface the per-section changed range.
- chars/4 remains the estimator; all figures stay directional, not billable.
