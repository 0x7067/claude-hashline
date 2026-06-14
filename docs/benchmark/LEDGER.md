# Optimize-loop ledger

Harness-fixed-model optimization per `.claude/skills/optimize-loop`. Hold the
model fixed; mutate the hashline harness; let `bench/paired.ts` decide keeps.

## Setup

- **Corpus:** `bench/corpus/clean-room-shared` (pin `github:0x7067/clean-room@90c8835`)
- **Generation:** `bun run bench/generate.ts bench/corpus/clean-room-shared <dir> --per-file 3` → 16 fixtures (deterministic walk order ⇒ stable indices).
- **Single corpus.** Holdout is carved from the same corpus, so overfit detection is weak; treat holdout agreement as a sanity check, not proof.

### Dev / holdout split (stratified, by fixture index)

- **Dev** (`bench/fixtures`, 11): 0000-eq, 0001-add, 0002-add, 0004-rel, 0005-boolean(hard-anchor), 0006-rel, 0007-guard, 0008-guard, 0009-add, 0011-guard, 0012-rel
- **Holdout** (`bench/fixtures-holdout`, 5): 0003-eq, 0010-add, 0013-rel, 0014-guard, 0015-add

Both fixture dirs are gitignored (regenerate from corpus). To reproduce: regenerate with `--per-file 3`, then move the five holdout indices above.

## Benchmark-realism fixes (tracked separately from the harness trajectory)

These fix how the benchmark is *posed*; they are NOT harness wins and are not part of the keep/discard trajectory.

| date | change | rationale |
|---|---|---|
| 2026-06-14 | `mutate.ts`: mask comments/strings before operator mutation | fixture 0007 mutated a `+` inside a prose comment → unsolvable "fix the arithmetic" task that burned 31 turns. |
| 2026-06-14 | `mutate.ts`/`generate.ts`: clear stale `NNNN-*` dirs on regen | generator never cleared outDir; orphaned pre-fix fixtures silently poisoned sweeps. |

### Known artifact (NOT fixed — would be gaming)

- **removed-guard** fixtures fail in *both* arms (exact-text-match can't credit a semantically-equivalent restored guard). This hits hashline and control identically, so `paired.ts` sees no flip and it does not bias the trajectory. Removing the kind because it fails would be editing the corpus to move numbers — forbidden. Revisit only via semantic scoring, not deletion.

## Harness trajectory (the actual loop)

Objective: minimize mean edit-failures/task on sonnet/hashline/dev; guardrails = dev pass not worse by ≥1 fixture, haiku not worse; tie-break fewer tokens.

| cycle | lever | hypothesis | label | dev verdict | haiku | holdout | kept? | cost (runs) |
|---|---|---|---|---|---|---|---|---|
| — | (baseline) | — | — | — | — | — | — | — |
