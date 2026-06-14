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

Objective: minimize mean edit-failures/task; guardrails = pass not worse by ≥1 fixture, the other model not worse; tie-break fewer tokens.

### Baseline (clean-baseline.md, dev n=11, max-turns 25)

| model | arm | pass | edit-fail/task | tokens | turns |
|---|---|---|---|---|---|
| sonnet | hashline | 90.9% | **0.0** | 470 | 3.5 |
| sonnet | control | 90.9% | 0.1 | 677 | 3.4 |
| haiku | hashline | 72.7% | **0.3** | 470 | 3.6 |
| haiku | control | 81.8% | 0.0 | 698 | 3.4 |

**Classification (analyze.ts):** 3 genuine hashline rejections / 22 sessions, 0 blocked-built-in, 0 path-bugs. All 3 are the *identical* category: colon range `replace N:N:` instead of `replace N..N:` (model copies the `N:` read-row label). All 3 on **haiku**; sonnet edit-fails are at the floor.

**→ Saturated-primary pivot applied:** sonnet/hashline edit-fails = 0.0 (no headroom), so primary metric is read on **haiku**; sonnet is the must-not-regress guardrail.

| cycle | lever | hypothesis | label | primary (haiku) verdict | sonnet guardrail | holdout | kept? | cost (runs) |
|---|---|---|---|---|---|---|---|---|
| baseline | — | — | — | edit-fail 0.3, pass 72.7% | 0.0 / 90.9% | — | — | 44 (shared w/ task 3) |
| 1 | core.ts tolerant-normalize | accept `replace N:M:` → `N..M:`; removes the 100% rejection category → haiku edit-fails↓ | harness fix (lever 3) | **KEEP** edit-fail 0.3→0.03 (3 rejections→0), pass +1 | KEEP (tie-break): 0 regress, tok −141 | **uninformative** (see below) | **YES** | 22 cand + 20 holdout |

### Cycle 1 detail

- **Dev primary (haiku, n=11):** all 3 genuine colon-range rejections (`0002`, `0004`, `0005`) went `editfail 1→0`; `0002` flipped to pass (+1 net, 0 lost). `paired.ts` → KEEP.
- **Dev guardrail (sonnet, n=11):** edit-fails flat 0→0 (sonnet never made the mistake), 0 pass regression, tokens −141/task. KEEP (tie-break).
- **Holdout (n=5) = UNINFORMATIVE, not a veto.** Both holdout sweeps had **0 total rejections** (baseline and candidate), i.e. the colon-range case never occurred → `normalizeColonRanges` was a strict no-op there. `paired.ts` reported DISCARD purely from single-fixture pass flips the change *cannot* cause: `0014-removed-guard` (the known exact-match artifact class) on haiku, and `0010-operator-add` on sonnet (regex never triggers for sonnet's correct syntax). Per the holdout guard added to the skill this cycle, an uninformative holdout decides nothing.
- **Decision:** KEEP on mechanism (deterministic, unit-tested, no-op except on unambiguous malformed input) + dev evidence + safety. Committed.

### Convergence

Baseline classification found the colon-range category was **100%** of genuine rejections. Cycle 1 drove haiku dev rejections to **0**. With no genuine-rejection category left and sonnet already at the floor, the loop has **no remaining signal** → converged after 1 cycle (stopping rather than spending cap-3's remaining budget hunting noise).
