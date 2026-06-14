# Hashline optimization loop — ledger

Closed feedback loop hill-climbing the hashline harness against the benchmark.
Objective: minimize edit-failures/task on the **hashline arm, sonnet, 12
fixtures**; guardrail: hashline pass rate must not drop; tie-break: tokens.
See `.claude/skills/optimize-loop/SKILL.md`.

Corpus: `github:0x7067/clean-room@90c8835` · Formatter: `prettier@3.8.4`

| iter | change (one lever) | pass | edit-fail/task | tokens | decision | commit |
|------|--------------------|------|----------------|--------|----------|--------|
| 0 (baseline) | none — post jail-fix harness | _pending_ | _pending_ | _pending_ | baseline | — |

_Decisions: KEEP = pass not regressed AND edit-fail improved (tie-break tokens); DISCARD otherwise (reverted)._
