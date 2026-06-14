---
name: optimize-loop
description: Closed feedback loop that hill-climbs the hashline harness. Each cycle re-measures a fixed baseline and a candidate back-to-back, compares them paired per-fixture, and keeps the candidate only if it improves the objective without regressing pass rate beyond noise. Use when the user asks to "optimize hashline", "run the improvement loop", or "tune the harness against the benchmark".
---

# Hashline optimization loop

Hold the model fixed; mutate the **harness** (the hashline tooling); let the
benchmark decide what survives. This is the article's thesis applied to Claude.

The hard part is not the loop — it is not fooling yourself. n=12 is noisy: the
control arm has swung ~8pp between byte-identical runs, and a single flipped
fixture is 8.3pp. So the method below is built around **paired, concurrent**
measurement and a **holdout**, not single aggregate runs compared across time.

## Objective (the keep/discard rule)

Measured on the **hashline arm**, **sonnet**, the **dev** fixtures:

- **Primary:** minimize mean **edit-failures/task** (the retry-loop friction).
- **Guardrail 1 (pass):** hashline pass rate must not regress beyond the noise
  **margin** (default: a net loss of ≥1 fixture vs the concurrently-measured
  baseline blocks the keep).
- **Guardrail 2 (haiku):** the same change, measured on **haiku**, must not make
  haiku's edit-fails or pass *worse* — a sonnet-only win that hurts the weaker
  model is a wording change that traded one model for another, not a harness fix.
- **Tie-break:** fewer mean output **tokens**.

The verdict is computed by `bench/paired.ts` (below), which encodes exactly this
rule. Do not eyeball two report tables — they were measured at different times.

### Saturated-primary pivot

If the baseline **sonnet/hashline** mean edit-failures/task is already ≈ 0, the
primary metric has no headroom — `paired.ts --model sonnet` will DISCARD every
change because nothing can drop below the floor, and the genuine-rejection signal
lives on the weaker model instead. In that case **pivot**: read the primary
objective off **haiku** (`paired.ts --model claude-haiku-4-5`, the model that
still shows genuine rejections) and use **sonnet** as the must-not-regress
guardrail. This changes only *which model the objective is read on*, never the
keep bar itself (still edit-fails-primary with the pass margin), so it is not a
way to lower the bar. Record the pivot in the ledger and re-check each cycle —
once haiku's edit-fails also reach the floor, the loop is done.

## Two kinds of change — label every cycle as one

1. **Harness fix** — the change makes the *tooling* better at communicating with
   the model (clearer description, self-correcting error message). This is the
   loop's real target.
2. **Benchmark-realism fix** — the change compensates for an *artifact of how the
   benchmark is posed*. Example: the directory-listing change to `hashlineRead`
   only helps because `task.md` says "near line N" without naming the file, so
   the model probes `read "."`. A real editor task names the file. That is a
   benchmark-realism question (should `task.md` name the target?), not a harness
   win — fixing it inflates the score without improving the tool.

Decide the label **before** measuring and record it in the ledger. A
benchmark-realism fix should be resolved by fixing the *benchmark* (e.g. task
wording) — never by editing fixtures, scorer, or corpus to move numbers — and is
measured separately from the harness trajectory.

## Levers (what a harness-fix cycle may touch — exactly one per cycle)

1. `src/descriptions.ts` — the read/edit tool prompts.
2. `src/core.ts` `errMessage()` and the inline rejection strings — make failures
   self-correcting (e.g. when `Patch.parse` rejects `replace N:M`, append a hint
   that ranges use `N..M`).
3. `src/core.ts` **tolerant input normalization** — be liberal in what you accept:
   rewrite a common, unambiguous model syntax variant into the grammar before
   `Patch.parse` (e.g. normalize a colon range `replace N:M:` → `replace N..M:`).
   This eliminates a rejection category outright rather than explaining it, so it
   moves the primary metric (edit-fails) directly. Only normalize variants with a
   single safe interpretation; never paper over a genuinely ambiguous patch.

Pick the change from the **dominant genuine-rejection category** in the latest
classification (not path-bugs or blocked-built-ins — those are artifacts). Prefer
a tolerance fix (lever 3) when the model's *intent* is clear and only the syntax
is wrong; prefer a description/message fix (levers 1–2) when the model's intent
itself is wrong.

## Dev / holdout split

Tune only on the **dev** subset; never look at the **holdout** while proposing
changes. After a change is KEPT on dev, confirm it on holdout before committing
the *trajectory* as real. A change that wins on dev but not holdout is overfit to
those 12 tasks — keep the code only if holdout agrees (or is at least neutral).

Maintain the split as two fixture directories (e.g. `bench/fixtures` = dev,
`bench/fixtures-holdout` = holdout) or a documented fixture-name list in the
ledger. If only one corpus exists, say so in the ledger and treat every result as
dev-only (no overfitting claim either way) until a holdout is carved out.

**A holdout can only veto a change it actually exercised.** Before treating a
holdout DISCARD as real, check whether the change *fired* on the holdout: did its
targeted rejection category occur (compare baseline-vs-candidate rejection
counts)? If the holdout's edit-fails are identical (e.g. 0→0 across every
fixture), the change was a no-op there — the holdout is **uninformative**, and its
pass flips are sampling noise on fixtures the change cannot affect, NOT an
overfit signal. An uninformative holdout neither confirms nor vetoes; decide on
mechanism + dev + safety, record it as uninformative (never as a clean pass), and
prefer enlarging the holdout so it exercises the change next time. This is the
symmetric guard to "don't keep on dev noise": don't *discard* on holdout noise
either.

## Cycle

1. **Measure baseline and candidate back-to-back.** Always re-measure the current
   best in the same session as the candidate — never compare against a stale
   report. First the baseline (current `HEAD`):
   ```bash
   bun run bench/run.ts bench/fixtures --models claude-sonnet-4-6 --arms hashline \
     --max-turns 25 --session-timeout 300 --out docs/benchmark/iters/<label>-base.md
   ```
   Apply the one proposed change, then measure the candidate to a second label.
   Each run writes a sibling `<label>.records.json` with per-fixture outcomes.
   The runs are long; launch in the background and wait for completion.

2. **Classify** the baseline failures: `bun run bench/analyze.ts <base>.md`
   (no `--json` for the human breakdown, `--json` for the metric object).
   Identify the top genuine-rejection category and label the next change
   harness-fix vs benchmark-realism (above).

3. **Propose ONE change** targeting that category. Keep it minimal; state the
   hypothesis (e.g. "models write `replace 12:14:`; clarify in the edit
   description and the parse-error message that ranges use `..`").

4. **Verify locally:** `bun run typecheck && bun test` must pass before measuring.

5. **Compare paired:**
   ```bash
   bun run bench/paired.ts docs/benchmark/iters/<label>-base.records.json \
     docs/benchmark/iters/<label>-cand.records.json --model claude-sonnet-4-6 --margin 1
   ```
   This prints per-fixture pass flips + edit-fail deltas and a KEEP/DISCARD
   verdict under the rule. For a KEEP candidate, run `paired.ts` again on the
   **haiku** records (Guardrail 2) and on the **holdout** records before trusting
   it.

6. **Keep or discard:** if KEPT (dev verdict KEEP, haiku not worse, holdout not
   worse), `git commit` the change and update `best`. If DISCARDED,
   `git checkout -- <files>` to revert. Append a ledger row including the cost.

7. **Repeat** until **2 consecutive cycles** produce no KEEP, or the
   **iteration cap** (default 6 cycles) is hit, or the user stops it. Then
   summarize the trajectory and the running cost.

## Honesty rules

- Decisions are **paired and concurrent** (`paired.ts`), never two means compared
  across time. A net pass swing within the margin is noise, not signal.
- Never edit a fixture, the scorer, or the corpus to make numbers move — that is
  gaming the benchmark. Only the two harness levers, and benchmark-realism fixes
  applied to the *task posing*, tracked separately.
- The **confound** stands: gains may reflect the format getting easier for an
  RL-untrained syntax, not the format being good. Keep reporting it.
- Track **cost** per cycle (each cycle is ~2 full sonnet sweeps + guardrail/
  holdout runs). Put a running token/$/wall-clock estimate in the ledger so the
  loop's spend stays visible against the iteration cap.
- For a human-facing summary of any single run, run `bun run bench/analyze.ts
  <report.md>` (no `--json`) — it prints the ASCII summary + takeaways and writes
  a full markdown analysis to `--out`.
