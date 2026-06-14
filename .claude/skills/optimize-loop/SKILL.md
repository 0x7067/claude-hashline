---
name: optimize-loop
description: Closed feedback loop that hill-climbs the hashline harness. Each cycle measures the hashline arm on the benchmark, proposes ONE targeted change to the tool descriptions or rejection messages from the dominant failure category, re-measures, and keeps the change only if it improves the objective without regressing pass rate. Use when the user asks to "optimize hashline", "run the improvement loop", or "tune the harness against the benchmark".
---

# Hashline optimization loop

Hold the model fixed; mutate the **harness** (the hashline tooling); let the
benchmark decide what survives. This is the article's thesis applied to Claude.

## Objective (the keep/discard rule)

Measured on the **hashline arm**, **sonnet**, all 12 fixtures:

- **Primary:** minimize mean **edit-failures/task** (the retry-loop friction).
- **Guardrail:** hashline **pass rate must not drop** below the current best.
- **Tie-break:** fewer mean output **tokens**.

A candidate is **KEPT** iff `pass >= best.pass` AND `editFail < best.editFail`
(or `editFail == best.editFail` AND `tokens < best.tokens`). Otherwise **DISCARD**
(revert the change). Record every cycle in `docs/benchmark/loop-log.md`.

## Levers (what "one change" may touch — exactly one per cycle)

1. `src/descriptions.ts` — the read/edit tool prompts.
2. `src/core.ts` `errMessage()` and the inline rejection strings — make failures
   self-correcting (e.g. when `Patch.parse` rejects `replace N:M`, append a hint
   that ranges use `N..M`).

Pick the change from the **dominant genuine-rejection category** in the latest
classification (not path-bugs or blocked-built-ins — those are artifacts).

## Cycle

1. **Measure** the current code (hashline arm, sonnet, 12 fixtures):
   ```bash
   bun run bench/run.ts bench/fixtures --models claude-sonnet-4-6 --arms hashline \
     --max-turns 25 --session-timeout 300 --out docs/benchmark/iters/<label>.md
   bun run bench/analyze.ts docs/benchmark/iters/<label>.md --json   # metric JSON
   ```
   The run is long; launch it in the background and wait for completion. The
   `--json` output gives `{ hashline: {pass, editFail, tokens}, classification }`.

2. **Classify** the failures (the `classification` field, or run `analyze.ts`
   without `--json` for the breakdown). Identify the top genuine-rejection
   category: range-syntax errors, read-before-edit trips, wrong-path probes, etc.

3. **Propose ONE change** targeting that category. Keep it minimal and explain
   the hypothesis (e.g. "models write `replace 12:14:`; clarify in the edit
   description and in the parse-error message that ranges use `..`").

4. **Verify locally:** `bun run typecheck && bun test` must pass before measuring.

5. **Re-measure** (new `<label>`), compare to best per the keep/discard rule.

6. **Keep or discard:** if KEPT, `git commit` the change and update `best`. If
   DISCARDED, `git checkout -- <files>` to revert. Append a row to the ledger.

7. **Repeat** until 2 consecutive cycles produce no improvement, or a cap the
   user set. Then summarize the trajectory.

## Honesty rules

- Single 12-fixture runs are **noisy**; a sub-fixture delta may be variance.
  Prefer changes with a clear margin; note when a result is within noise.
- Never edit a fixture, the scorer, or the corpus to make numbers move — that is
  gaming the benchmark, not improving the harness. Only the two levers above.
- The **confound** stands: gains may reflect the format getting easier for an
  RL-untrained syntax, not the format being good. Keep reporting it.
- Run `benchmark-report` for the human-facing summary of any measurement.
