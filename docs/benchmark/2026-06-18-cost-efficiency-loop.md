# Hashline cost-efficiency autoresearch loop — 2026-06-18

- **Coordinator:** GPT-5.5 high.
- **Goal:** reduce steady-state token overhead of the hashline MCP tool surface without making haiku compliance worse.
- **Benchmark status:** this environment does **not** have the `claude` CLI on `PATH`, so I could not run the live haiku benchmark here. The work below is an offline prompt-description ablation and guardrail loop, not a replacement for a real `claude-haiku-*` run.
- **Experiment type:** local prompt-description ablation loop. Each experiment edited the description candidate, measured total model-facing description characters (chars/4 is the repository's token heuristic), and checked retention of eight critical affordances: `[PATH#TAG]`, stale-tag rejection, two-dot ranges, tagless create, disabled built-ins, ripgrep, `offset/limit`, and `maxResults`.
- **Baseline:** committed `src/descriptions.ts` before this loop: 3,244 model-facing description characters (about 811 chars/4 tokens), 4,187 source characters.
- **Selected patch after haiku-compliance review:** conservative compact descriptions in `src/descriptions.ts`: 2,406 model-facing description characters (about 602 chars/4 tokens), 2,839 source characters.

## Hypothesis log

| id | hypothesis | result |
|---|---|---|
| H1 | Tool-description overhead is a meaningful fixed cost for every coordinator context and MCP tool-selection turn. | Supported by size audit: the old descriptions were 3,244 model-facing characters. |
| H2 | The largest safe saving comes from removing repeated prose while retaining examples and syntax invariants. | Partly supported: raw compression can exceed 50%, but that is too risky for haiku compliance. |
| H3 | Removing all examples would save more, but risks higher patch-construction failures. | Rejected for implementation: final keeps read, search, edit, and create examples. |
| H4 | Compact descriptions need regression tests so later edits do not silently re-inflate the tool surface. | Implemented with `test/descriptions.test.ts`. |
| H5 | Given prior haiku compliance difficulty, terse wording should be rejected unless live haiku benchmarks prove it is safe. | Accepted: final candidate gives back tokens to restore explicit “copy header”, visible-line edit, colon-range, literal-prefix, and read/search-before-edit guidance. |

## Experiments

The loop ran 25 candidate ablations. Experiments 1-24 were incremental prompt candidates measured by a local script; experiment 25 is the implemented conservative candidate, measured from the actual edited `src/descriptions.ts`.

| exp | candidate change | model-facing chars | reduction vs baseline | critical checks | decision |
|---:|---|---:|---:|---:|---|
| 1 | Establish compact paraphrase baseline. | 1,871 | 42.3% | 8/8 | Too terse: no full examples. |
| 2 | Shorten read opening sentence. | 1,845 | 43.1% | 8/8 | Kept directionally. |
| 3 | Shorten search opening sentence. | 1,816 | 44.0% | 8/8 | Kept directionally. |
| 4 | Shorten edit opening sentence. | 1,769 | 45.5% | 8/8 | Kept directionally. |
| 5 | Remove explanatory 4-hex hash sentence. | 1,722 | 46.9% | 8/8 | Kept; not needed for operation. |
| 6 | Remove ripgrep linear-time aside. | 1,667 | 48.6% | 8/8 | Kept; regex limits remain. |
| 7 | Remove redundant read-before-edit sentence. | 1,622 | 50.0% | 8/8 | Rejected after compliance review. |
| 8 | Strengthen built-in editor directive. | 1,652 | 49.1% | 8/8 | Kept despite small cost. |
| 9 | Re-add minimal read example marker. | 1,690 | 47.9% | 8/8 | Too skeletal; final uses fuller example. |
| 10 | Replace “WITHOUT read” wording with lowercase. | 1,673 | 48.4% | 8/8 | Kept directionally. |
| 11 | Restore explicit invalid colon range warning. | 1,690 | 47.9% | 8/8 | Kept; failure-prevention value. |
| 12 | Add one-hunk-per-range instruction. | 1,714 | 47.2% | 8/8 | Kept. |
| 13 | Compact “copy header verbatim” wording. | 1,694 | 47.8% | 8/8 | Partly rejected: final restores “verbatim”. |
| 14 | Restore truncation guidance for search. | 1,739 | 46.4% | 8/8 | Kept. |
| 15 | Restore literal `+` / `-` body escaping. | 1,789 | 44.9% | 8/8 | Kept; prevents malformed bodies. |
| 16 | Shorten edit-success chaining sentence. | 1,712 | 47.2% | 8/8 | Kept directionally. |
| 17 | Compact search context-marker sentence. | 1,691 | 47.9% | 8/8 | Partly rejected: final is more explicit. |
| 18 | Compact operation list. | 1,687 | 48.0% | 8/8 | Partly kept, but final expands for readability. |
| 19 | Compact read output sentence. | 1,657 | 48.9% | 8/8 | Kept. |
| 20 | Compact Grep preference sentence. | 1,614 | 50.2% | 8/8 | Kept. |
| 21 | Compact stale-tag/read-search anchoring sentence. | 1,529 | 52.9% | 8/8 | Too terse for haiku without live proof. |
| 22 | Compact search snapshot sentence. | 1,422 | 56.2% | 8/8 | Too terse for implementation. |
| 23 | Compact tagless-create sentence. | 1,419 | 56.3% | 8/8 | Too terse for implementation. |
| 24 | No-op retest for stability of best terse candidate. | 1,419 | 56.3% | 8/8 | Stable, but rejected as over-compressed. |
| 25 | Implement conservative compact descriptions with examples and explicit haiku-facing guidance. | 2,406 | 25.8% | 8/8 | Selected. |

## Outcome

The selected implementation intentionally gives back raw compression versus the most aggressive candidates because haiku compliance was already a known risk. It removes 838 model-facing characters from the MCP tool descriptions while retaining syntax examples, operation grammar, explicit copy-header guidance, search/edit chaining guidance, and safety constraints.

## Live benchmark follow-up

Before claiming a production win, run the real benchmark on a machine with `claude` available, especially for haiku:

```bash
bun run bench/run.ts <fixtures-dir> \
  --models claude-haiku-4-5 \
  --arms hashline,control --max-turns 30 --out docs/benchmark/<date>-haiku-description-check.md
```

Acceptance should require no regression in haiku pass rate or edit-failure/task versus the pre-change descriptions, not just lower prompt size.
