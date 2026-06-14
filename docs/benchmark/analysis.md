# Hashline benchmark — analysis
- **Corpus:** `github:0x7067/clean-room@90c8835`
- **Models:** claude-sonnet-4-6, claude-haiku-4-5
- **Formatter (oracle):** `prettier@3.8.4 (corpus .prettierrc)`
- **Source report:** `docs/benchmark/iters/full-baseline-named.md`
- **Edit-failure classification root:** `hashline-bench-dMnVja`
## Results (overall + by difficulty)
| model | arm | difficulty | n | pass | edit-fail/task | out-tokens | turns | masked |
|---|---|---|---|---|---|---|---|---|
| claude-haiku-4-5 | control | all | 12 | 75.0% | 0.0 | 1194.2 | 5.0 | 0 |
| claude-haiku-4-5 | control | hard-anchor | 1 | 100.0% | 0.0 | 650.0 | 3.0 | 0 |
| claude-haiku-4-5 | control | simple | 11 | 72.7% | 0.0 | 1243.6 | 5.2 | 0 |
| claude-haiku-4-5 | hashline | all | 12 | 66.7% | 0.4 | 938.0 | 5.0 | 0 |
| claude-haiku-4-5 | hashline | hard-anchor | 1 | 100.0% | 1.0 | 1303.0 | 6.0 | 0 |
| claude-haiku-4-5 | hashline | simple | 11 | 63.6% | 0.4 | 904.8 | 4.9 | 0 |
| claude-sonnet-4-6 | control | all | 12 | 91.7% | 0.1 | 1062.3 | 3.6 | 0 |
| claude-sonnet-4-6 | control | hard-anchor | 1 | 100.0% | 1.0 | 890.0 | 5.0 | 0 |
| claude-sonnet-4-6 | control | simple | 11 | 90.9% | 0.0 | 1077.9 | 3.5 | 0 |
| claude-sonnet-4-6 | hashline | all | 12 | 83.3% | 0.0 | 963.7 | 3.3 | 0 |
| claude-sonnet-4-6 | hashline | hard-anchor | 1 | 100.0% | 0.0 | 260.0 | 3.0 | 0 |
| claude-sonnet-4-6 | hashline | simple | 11 | 81.8% | 0.0 | 1027.6 | 3.4 | 0 |
## hashline vs control (overall deltas)
| model | Δpass | token ratio | Δturns | Δedit-fail/task |
|---|---|---|---|---|
| haiku | -8.3pp | 0.79x | +0.0 | +0.4 |
| sonnet | -8.4pp | 0.91x | -0.3 | -0.1 |
## Edit-failure breakdown (hashline arm, from transcripts)

| category | count | share |
|---|---|---|
| genuine hashline rejection | 5 | 100% |
| blocked built-in (familiarity reflex) | 0 | 0% |
| jail path-rejection | 0 | 0% |
| other | 0 | 0% |

Total 5 errored tool_results across 24 hashline sessions.
## Key takeaways
- haiku: hashline lost 8pp on pass rate; -21% tokens, +0.0 turns, +0.4 edit-fails/task vs control.
- sonnet: hashline lost 8pp on pass rate; -9% tokens, -0.3 turns, -0.1 edit-fails/task vs control.
- No masked passes: the formatter oracle hid no whitespace/indent deviations in either arm.
- Edit-failure breakdown (hashline arm, 5 errors over 24 sessions): 5 genuine hashline rejections (100%), 0 blocked-built-in reflexes (0%), 0 jail path-rejections (0%), 0 other.
- Familiarity note: 0 blocked-built-in attempts — the model adopted the hashline tools without reaching for str_replace, so the friction is patch CONSTRUCTION, not tool selection.
## Limitations
- **Confound (adv-02):** hashline and control differ on two variables — edit format AND Claude's RL-training familiarity with the tooling. A control-favoring result cannot, without a familiarity-control arm, fully separate "hash format is worse" from "Claude is not trained on this patch syntax".
- **Sample size:** small per-cell n (see table); treat single-fixture difficulty cells (e.g. hard-anchor n=1) as anecdotes, not estimates.
- **Pass oracle:** prettier-normalized equality; the `masked` column flags any raw deviation the formatter hid.
