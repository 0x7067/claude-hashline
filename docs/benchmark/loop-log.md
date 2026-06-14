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
| 0 (baseline) | — | none — post jail-fix harness | sonnet 0.917 (11/12) | 0.8 | 939.7 | baseline | 1 sonnet sweep | — |

Iter-0 baseline (sonnet, hashline, n=12): pass 0.917, edit-fail/task 0.8,
tokens 939.7, turns 4.8. Failures: 100% directory-discovery probes (`read "."`).
That failure is a **benchmark-realism** artifact (tasks say "near line N" without
naming the file), not a harness defect — resolve via task wording, measured
separately from the harness trajectory.

_Decisions: KEEP = sonnet pass not regressed beyond margin AND edit-fail improved
(tie-break tokens) AND haiku not worse AND holdout not worse; DISCARD otherwise
(reverted)._
