# Hashline benchmark — analysis
- **Corpus:** `github:0x7067/clean-room@90c8835`
- **Models:** claude-haiku-4-5, claude-sonnet-4-6
- **Formatter (oracle):** `prettier@3.8.4 (corpus .prettierrc)`
- **Source report:** `report.md`
- **Edit-failure classification root:** `hashline-bench-kEwZrp`
## Results (overall + by difficulty)
| model | arm | difficulty | n | pass | edit-fail/task | out-tokens | turns | masked |
|---|---|---|---|---|---|---|---|---|
| claude-haiku-4-5 | control | all | 12 | 75.0% | 0.3 | 1099.2 | 6.1 | 0 |
| claude-haiku-4-5 | control | hard-anchor | 1 | 100.0% | 0.0 | 965.0 | 4.0 | 0 |
| claude-haiku-4-5 | control | simple | 11 | 72.7% | 0.3 | 1111.4 | 6.3 | 0 |
| claude-haiku-4-5 | hashline | all | 12 | 83.3% | 0.7 | 964.0 | 7.1 | 0 |
| claude-haiku-4-5 | hashline | hard-anchor | 1 | 100.0% | 0.0 | 596.0 | 5.0 | 0 |
| claude-haiku-4-5 | hashline | simple | 11 | 81.8% | 0.7 | 997.5 | 7.3 | 0 |
| claude-sonnet-4-6 | control | all | 12 | 83.3% | 0.1 | 859.5 | 5.3 | 0 |
| claude-sonnet-4-6 | control | hard-anchor | 1 | 100.0% | 0.0 | 690.0 | 4.0 | 0 |
| claude-sonnet-4-6 | control | simple | 11 | 81.8% | 0.1 | 874.9 | 5.5 | 0 |
| claude-sonnet-4-6 | hashline | all | 12 | 91.7% | 0.8 | 939.7 | 4.8 | 0 |
| claude-sonnet-4-6 | hashline | hard-anchor | 1 | 100.0% | 1.0 | 451.0 | 5.0 | 0 |
| claude-sonnet-4-6 | hashline | simple | 11 | 90.9% | 0.7 | 984.1 | 4.8 | 0 |
## hashline vs control (overall deltas)
| model | Δpass | token ratio | Δturns | Δedit-fail/task |
|---|---|---|---|---|
| haiku | +8.3pp | 0.88x | +1.0 | +0.4 |
| sonnet | +8.4pp | 1.09x | -0.5 | +0.7 |
## Edit-failure breakdown (hashline arm, from transcripts)

| category | count | share |
|---|---|---|
| genuine hashline rejection | 16 | 94% |
| blocked built-in (familiarity reflex) | 0 | 0% |
| jail path-rejection | 0 | 0% |
| other | 1 | 6% |

Total 17 errored tool_results across 24 hashline sessions.
## Key takeaways
- haiku: hashline won by 8pp on pass rate; -12% tokens, +1.0 turns, +0.4 edit-fails/task vs control.
- sonnet: hashline won by 8pp on pass rate; +9% tokens, -0.5 turns, +0.7 edit-fails/task vs control.
- No masked passes: the formatter oracle hid no whitespace/indent deviations in either arm.
- Edit-failure breakdown (hashline arm, 17 errors over 24 sessions): 16 genuine hashline rejections (94%), 0 blocked-built-in reflexes (0%), 0 jail path-rejections (0%), 1 other.
- Familiarity note: 0 blocked-built-in attempts — the model adopted the hashline tools without reaching for str_replace, so the friction is patch CONSTRUCTION, not tool selection.
## Limitations
- **Confound (adv-02):** hashline and control differ on two variables — edit format AND Claude's RL-training familiarity with the tooling. A control-favoring result cannot, without a familiarity-control arm, fully separate "hash format is worse" from "Claude is not trained on this patch syntax".
- **Sample size:** small per-cell n (see table); treat single-fixture difficulty cells (e.g. hard-anchor n=1) as anecdotes, not estimates.
- **Pass oracle:** prettier-normalized equality; the `masked` column flags any raw deviation the formatter hid.
