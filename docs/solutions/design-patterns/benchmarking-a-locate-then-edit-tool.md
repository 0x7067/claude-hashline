---
title: Benchmarking a search/navigation tool requires withholding the path — and harness search lifts weak models most
date: 2026-06-14
last_updated: 2026-06-14
category: design-patterns
module: bench
problem_type: design_pattern
component: testing_framework
severity: medium
applies_when:
  - Benchmarking a search, grep, or file-navigation tool in an agent harness
  - Measuring whether a specific tool was actually exercised, not just available
  - Evaluating harness tooling across model tiers (weak vs. strong)
tags: [benchmark, search, harness, evaluation, hashline, model-tiers]
---

# Benchmarking a search/navigation tool requires withholding the path — and harness search lifts weak models most

## Context

The hashline benchmark fixtures are single-file bug fixes whose task names the
target file (`File: jitter.ts`, `near line 8`). That design measures the *edit*
tool but never the *search* tool: the model reads the named file and edits it,
with no reason to search. After adding a `search` tool we needed the benchmark to
actually exercise it — and to prove it did.

## Guidance

**To benchmark a locate/navigation tool, the task must make locating part of the
work.** Three changes turn an edit benchmark into a locate-then-edit benchmark:

1. **Multi-file workspace.** Drop the target file in among distractor files
   (other fixtures' sources) so "which file" is a real question.
2. **Withhold the path.** Strip the filename and line number from the prompt;
   point the model at a *searchable anchor* (a stable identifier near the bug)
   instead. The model must search to find the file.
3. **Lock down alternative navigation for the tool-under-test's arm.** If the arm
   meant to use your tool can still reach for a built-in (`Grep`/`Glob`/`Read`),
   it may never call your tool. Disallow the built-ins so the loop is forced
   through the tool you are measuring.

**Measure engagement, not just availability.** Add a metric that counts the
tool-under-test's calls per task (parse the transcript for `tool_use` blocks by
name). "The tool was allowed" is not evidence it was used; "1.7 search calls per
task" is. A zero count means the task didn't actually exercise the tool.

## Why This Matters

Without these changes a "search benchmark" silently measures editing — the tool
appears to make no difference because it is never invoked. The engagement metric
is the guardrail: it caught that the control arm located files via `Read`/`LS`
(0 search calls) while the hashline arm routed through `search` (1.3–1.8 calls),
making the comparison legible instead of a coin flip.

The empirical payoff: **harness search tooling lifts the weakest model the most.**
In the locate-then-edit task, the gap between giving a model good search tooling
and leaving it with built-ins was largest for the weakest model — the same shape
as the edit-format result the original hashline work found.

## When to Apply

- Any time the thing you want to measure is a tool the model can avoid using.
- Comparing harness tooling (not model capability) — hold the model fixed, vary
  the toolset, and force the path through the tool under test.

## Examples

Search-mode results (same 12 fixtures; path named in regression, withheld in
search-mode):

```
                 regression (path named)        search-mode (path withheld)
model    arm        pass   out-tok   search/task   pass    out-tok   search/task
haiku    control    83.3%   1121        —          66.7%    1682        0.0
haiku    hashline   83.3%    498        —          91.7%    1654        1.8
sonnet   control    91.7%   1217        —          83.3%    1263        0.0
sonnet   hashline   91.7%    753        —          83.3%     891        1.5
```

Reading: in regression both arms tie on pass (hashline just spends fewer tokens).
In search-mode, haiku with hashline `search` jumps **+25pp over control**
(66.7% → 91.7%) — the weak model gains most once locating is required. The
`search/task` column proves the hashline arm actually searched.

Implementation: `bench/search-mode.ts` (anchor derivation, prompt rewrite,
distractor selection), `--search` flag in `bench/run.ts`, and the `searchCalls`
metric in `bench/runner.ts`.

## Update (2026-06-14): read direction, not magnitude — n=12 is noisy

A later run swapped the search engine (hand-rolled JS walk → ripgrep) with a
**byte-identical output format** (held by deterministic unit tests, so the model
sees the same results; only the production mechanism changed). The search-mode
pass-rates still moved:

```
model    arm        prior pass    ripgrep pass   search/task   out-tok (ripgrep)
haiku    control    66.7%         66.7%          0.0           2129
haiku    hashline   91.7%         75.0%          1.0           1421
sonnet   control    83.3%         83.3%          0.0           1616
sonnet   hashline   83.3%         83.3%          1.7           1140
```

haiku-hashline dropped 91.7% → 75.0% — but that is a **2-fixture swing on n=12**
(≈8.3pp per fixture), and the format is provably unchanged, so it is run-to-run
LLM variance, not a capability regression. What held across both runs: hashline ≥
control for both models (haiku +8.3pp, sonnet tie), search/task > 0 (the tool is
used), and hashline spends fewer tokens than control (−33% / −29%).

**Lesson:** at n=12 a single-run pass-rate is a noisy point estimate; whole-fixture
swings are expected. Anchor "no regression" claims on (a) deterministic invariants
(format parity via unit tests), (b) arm-vs-arm *direction*, and (c) the engagement
metric — not on the absolute pass-rate of one run. To trust magnitude, grow the
fixture set or run multiple seeds and report variance.

## Related

- `docs/solutions/architecture-patterns/snapshot-producing-search-tool.md` — the
  search tool's design (why it can edit straight off a hit).
- [[Optimize loop]], [[Edit-fail]] (CONCEPTS.md) — the benchmark's existing
  vocabulary.
