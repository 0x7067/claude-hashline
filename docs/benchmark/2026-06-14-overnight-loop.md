# Overnight optimize-loop run — 2026-06-14

Autonomous run of the closed feedback loop (`/.claude/skills/optimize-loop`)
against the hashline benchmark. Corpus `github:0x7067/clean-room@90c8835`,
formatter `prettier@3.8.4`, 12 fixtures (dev-only; no holdout carved yet).
Models: `claude-sonnet-4-6`, `claude-haiku-4-5`. Real `claude -p` headless runs.

## TL;DR

One real harness improvement was found and kept; the loop then converged.

- **Realism fix (pre-loop):** naming the target file in each task removed a
  benchmark artifact that was the *entire* pre-loop sonnet failure mass —
  sonnet hashline edit-fails **0.8 → 0.0**. That "failure" was the model
  probing `read "."` to find the lone unnamed file, not an edit-format problem.
- **Iter-1 (KEPT, commit `115c730`):** a proactive "ranges use `..`, not `:`"
  hint in the edit tool description cut **haiku** hashline edit-fails
  **0.42 → 0.08** — 4 of 5 genuine `replace N:N:` rejections eliminated — with
  no sonnet regression and ~330 fewer tokens/task on haiku.
- **Iter-2 (DISCARDED, reverted):** the same caveat in the read description only
  shuffled the single remaining rejection between fixtures (net edit-fail Δ 0.00)
  and raised tokens. Noise-floor variance, not improvement.
- **Converged after iter-1.** No distinct genuine-rejection category remained
  above n=12 noise. Stopped rather than chase variance.

## What the genuine failure actually was

Across the hashline arm, the only genuine edit-format rejections came from
**haiku** writing a colon range — `replace 23:23:`, `replace 31:31:`,
`replace 147:147:` — instead of the dotted `replace 23..23:`. The parser
rejects it as *"payload line has no preceding hunk header."* Sonnet never made
this error. The likely cause: haiku pattern-matches the colon from the
`23:export …` read rows (where the colon labels the line) into range syntax.

Iter-1 attacked it proactively in the edit description. It worked: the rejections
the hint warns against stopped happening. The one survivor self-recovered via the
reactive error message (which already says *"Use `replace N..M:`"*), so that
fixture still passed — there was nothing left for a second description tweak to
fix, which is exactly what iter-2 showed.

## Numbers (paired, concurrent — `bench/paired.ts`)

Baseline = full 2×2 sweep (`full-baseline-named`), measured the same session on
the pre-change HEAD. Candidates measured immediately after each change.

| metric | haiku baseline | haiku after iter-1 | sonnet baseline | sonnet after iter-1 |
|---|---|---|---|---|
| pass | 0.667 | 0.75 (net +1, within noise) | 0.833 | 0.917 (net +1, within noise) |
| edit-fails/task | **0.42** | **0.08** | 0.0 | 0.0 |
| tokens/task Δ | — | −330 | — | −181 |

Iter-2 vs iter-1 (best): haiku edit-fail Δ **0.00** (0005 1→0, 0000 0→1),
sonnet flat, tokens up → DISCARD.

## The methodology earned its keep

Two findings only the paired/concurrent design caught:

1. **Sonnet hashline pass swung 91.7% → 83.3% on byte-identical code** between
   the iter-0 and full-baseline sweeps. A naive "compare two report tables"
   loop would have read that 8.3pp swing as a regression. The paired rule treats
   a net ±1-fixture swing as noise, so it didn't fire on it.
2. **Iter-2 looked like a win per-fixture** (0005 finally passed clean) but was
   net zero once paired — the gain was offset by a fresh rejection elsewhere.
   Eyeballing the 0005 line alone would have kept a no-op change.

The harness-vs-realism split also mattered: the biggest single number move
(sonnet 0.8 → 0.0 edit-fails) was explicitly *not* credited to the harness — it
was a benchmark artifact, fixed in the benchmark (task wording) and recorded
separately. Crediting it as a harness win would have been the easy lie.

## Standing caveats (unchanged by this run)

- **The confound (adv-02) stands.** hashline vs control differ on two variables
  at once — edit format *and* the model's training familiarity with the tool
  names. Both models scored ~8pp *lower* on hashline pass than control here.
  That is consistent with "an unfamiliar format costs a little pass rate" and is
  not evidence the format is good or bad on its own. The loop optimized
  edit-construction friction *within* the hashline arm; it does not resolve the
  confound.
- **n=12 is small.** Pass deltas of ±1 fixture are noise. Only the edit-fail
  reduction (5→1 genuine rejections, mechanistically tied to the hint) is a
  confident signal.
- **dev-only, no holdout.** The iter-1 hint is general (it names the exact wrong
  token haiku produced), so overfitting risk is low — but it was not confirmed
  on a held-out fixture set because none exists yet.

## Cost

108 headless `claude -p` runs total (12 + 48 + 24 + 24), ~103k model output
tokens captured across sweeps (input/cache tokens not counted). Four background
sweeps; one kept commit, one reverted.

## Kept changes (committed)

- `5e43c4d` fix(bench): name the target file in generated tasks (realism)
- `115c730` feat(descriptions): warn that line ranges use `..` not a colon (iter-1)

plus the tooling/methodology commits (`7bda4a3`, `5e9b93a`, `d396fb4`, `04edaaa`)
and this run's ledger updates. Iter-2 was reverted; tree is clean at the kept
state.

## If you want to push further

- Carve a **holdout** subset and re-confirm iter-1 there before trusting the
  trajectory as general.
- Add the **familiarity-control arm** (built-in Edit renamed to neutral tool
  names) to actually break the adv-02 confound — that, not more description
  tweaks, is the next real signal.
- Raise n (more fixtures / repeats) so pass deltas clear the noise floor.
