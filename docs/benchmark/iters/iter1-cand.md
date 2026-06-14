# Hashline benchmark report

- Formatter (pinned): `prettier@3.8.4 (corpus .prettierrc)`
- Corpus pin: `github:0x7067/clean-room@90c8835`
- Models: claude-sonnet-4-6, claude-haiku-4-5

`masked` = passes that only held after formatting (a raw whitespace/indent deviation the oracle hid; watch this for the hashline arm — adv-05).

| model | arm | difficulty | n | pass | edit-fail/task | out-tokens | turns | masked |
|---|---|---|---|---|---|---|---|---|
| claude-haiku-4-5 | hashline | all | 12 | 75.0% | 0.1 | 607.8 | 3.2 | 0 |
| claude-haiku-4-5 | hashline | hard-anchor | 1 | 100.0% | 1.0 | 460.0 | 4.0 | 0 |
| claude-haiku-4-5 | hashline | simple | 11 | 72.7% | 0.0 | 621.3 | 3.1 | 0 |
| claude-sonnet-4-6 | hashline | all | 12 | 91.7% | 0.0 | 782.4 | 3.8 | 0 |
| claude-sonnet-4-6 | hashline | hard-anchor | 1 | 100.0% | 0.0 | 269.0 | 3.0 | 0 |
| claude-sonnet-4-6 | hashline | simple | 11 | 90.9% | 0.0 | 829.1 | 3.8 | 0 |

_Confound: the hashline and control arms differ on two variables at once — edit format AND Claude's training familiarity with the tool names. A control-favoring result cannot, without the familiarity-control arm, distinguish "hash format is worse" from "Claude never saw these tool names" (adv-02)._
