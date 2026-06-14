# Hashline optimization loop — ledger

Closed feedback loop hill-climbing the hashline harness against the benchmark.
Objective: minimize edit-failures/task on the **hashline arm, sonnet, dev
fixtures**; guardrails: sonnet pass not regressed beyond noise margin, haiku not
made worse, holdout agrees; tie-break: tokens. Decisions are **paired** and
**concurrent** (`bench/paired.ts`), never two reports compared across time.
See `.claude/skills/optimize-loop/SKILL.md`.

Corpus: `github:0x7067/clean-room@90c8835` · Formatter: `prettier@3.8.4`
Split: single 12-fixture corpus — **dev-only**, no holdout carved out yet; treat
results as dev-only (no overfitting claim either way).

| iter | label (harness/realism) | change (one lever) | pass (paired) | edit-fail/task | tokens | decision | cost | commit |
|------|-------------------------|--------------------|---------------|----------------|--------|----------|------|--------|
| 0a (pre-realism) | realism artifact | old task wording (no filename) | sonnet 0.917 (11/12) | 0.8 | 939.7 | superseded | 1 sonnet sweep | — |
| 0 (baseline) | realism fix applied | tasks now name the file (5e43c4d) | sonnet 0.917 (11/12) | **0.0** | 804.6 | baseline | 1 sonnet sweep | 5e43c4d |

Iter-0 baseline (sonnet, hashline, n=12, **file-named tasks**): pass 0.917,
edit-fail/task **0.0**, tokens 804.6, turns 3.4. **Zero genuine hashline
rejections** and zero blocked-built-in reflexes across all 12 sessions — the
model adopted the hashline tools and constructed every patch without a single
format rejection. The one non-pass (`0009-removed-guard`) had 0 rejections: a
task-correctness miss (guard clause restored wrong), not edit-format friction,
so no harness lever can touch it.

Consequence: sonnet's edit-fail objective is **already at the floor (0.0)** on
this corpus. Naming the file (5e43c4d) removed the directory-discovery artifact
that was the entire pre-realism failure mass (0.8 → 0.0), confirming that "win"
was a benchmark artifact, not a harness property. With no genuine-rejection
category left on sonnet, the documented range-syntax lever has nothing to act on
here — the live hill-climbing signal (if any) is on **haiku**, which originally
showed genuine `replace N:M` range-syntax rejections. Next: full baseline (both
arms × sonnet+haiku) to measure the haiku guardrail and locate any surviving
genuine category before spending on candidate cycles.

_Decisions: KEEP = sonnet pass not regressed beyond margin AND edit-fail improved
(tie-break tokens) AND haiku not worse AND holdout not worse; DISCARD otherwise
(reverted)._
