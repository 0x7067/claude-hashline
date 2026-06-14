# Hashline benchmark report

- Formatter (pinned): `prettier@3.8.4 (corpus .prettierrc)`
- Corpus pin: `github:0x7067/clean-room@90c8835`
- Models: claude-sonnet-4-6, claude-haiku-4-5

`masked` = passes that only held after formatting (a raw whitespace/indent deviation the oracle hid; watch this for the hashline arm — adv-05).

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

_Confound: the hashline and control arms differ on two variables at once — edit format AND Claude's training familiarity with the tool names. A control-favoring result cannot, without the familiarity-control arm, distinguish "hash format is worse" from "Claude never saw these tool names" (adv-02)._
