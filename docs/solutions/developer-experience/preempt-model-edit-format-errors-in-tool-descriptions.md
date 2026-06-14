---
title: "Preempt predictable model edit-format errors in the tool description, not only the error message"
date: 2026-06-14
category: docs/solutions/developer-experience
module: hashline edit tool descriptions
problem_type: developer_experience
component: tooling
applies_when:
  - "Authoring an MCP/tool description for an edit DSL consumed by an LLM"
  - "The DSL's syntax visually overlaps with output the model also sees (e.g. line-number prefixes)"
  - "Smaller/cheaper models in the fleet make a syntax error that larger ones do not"
severity: low
related_components:
  - hashline edit tool
  - optimize loop
tags:
  - tool-description
  - prompt-engineering
  - edit-format
  - llm-dx
  - optimize-loop
  - haiku
---

# Preempt predictable model edit-format errors in the tool description, not only the error message

## Context
The hashline edit DSL spells a line range with two dots — `replace 23..23:`, and `replace 23:` for a single line. The `read` output, however, labels each line with a trailing colon: `23:export …`. Haiku models pattern-matched that colon into range syntax and emitted `replace 23:23:`, which the parser rejects with "payload line has no preceding hunk header." This was the **dominant genuine edit-format rejection** in the benchmark: haiku produced it in ~5 of 12 hashline sessions; sonnet never made the error at all. The reactive error message already said "Use `replace N..M:`", but waiting for the rejection cost a turn and tokens.

## Guidance
When a tool description documents an edit DSL whose syntax can be confused with output the model also sees, add a short, **specific** proactive warning that names the exact wrong token. The kept change added this to the edit description:

```text
Line ranges use TWO DOTS, never a colon between the numbers. Write `replace 12..14:`
for a span and `replace 23:` for a single line. A colon range like `replace 23:23:`
or `replace 12:14:` is INVALID and will be rejected — the `N:` in a `read` row
(`23:export …`) labels the line, it is not range syntax.
```

It names the precise failure form (`replace 23:23:`), contrasts it with both valid forms, and explains *why* the model is tempted (the read-row colon). It does not just restate the grammar.

## Why This Matters
A reactive error message is a backstop, not a fix: the model still has to make the mistake, read the rejection, and retry — one wasted turn and the tokens for it, every time. Moving the correction into the description preempts the error before the first attempt. In the optimize loop this cut haiku edit-fails **0.42 → 0.08 per task** (4 of 5 colon rejections eliminated) with **~330 fewer tokens/task** and no pass-rate regression, while sonnet (which never erred) was unaffected and also spent fewer tokens. The fix targets the weakest model in the fleet without taxing the strongest — proactive guidance is read once, not paid per-retry.

## When to Apply
- A cheaper model makes a syntax error a stronger model does not — fix it in the shared description; the strong model ignores guidance it already follows.
- The DSL syntax collides with something else in the model's view (here, line-number prefixes that look like ranges).
- You can name the *exact* wrong token. Vague "be careful with ranges" guidance does not move the needle; "`replace 23:23:` is invalid" does.

## Examples
**Where the proactive hint helps and where it does not — the boundary that defined convergence:**

- **Helps:** the warning eliminated the colon rejections it explicitly describes. (KEEP — commit `115c730`.)
- **Does not help — and was reverted:** iter-2 added the same colon caveat to the *read* description instead. It produced **zero** edit-fail delta — it merely shuffled the one surviving rejection between fixtures — and *raised* tokens (+333 haiku, +508 sonnet per task). (session history) The lesson: place the hint where the error is *produced* (the edit description), not where the confusing input is *displayed* (the read output). Duplicating it downstream is noise.
- **The single survivor self-recovered** via the reactive error message and the fixture still passed, which is why no second description tweak was warranted — there was nothing left for it to fix. (session history) Reactive error messages and proactive descriptions are complementary: the description kills the common case, the error message catches the tail.

## Related
- `docs/benchmark/2026-06-14-overnight-loop.md` — the optimize-loop run that found, measured (paired/concurrent), and converged on this change.
- Commit `115c730` — feat(descriptions): warn that line ranges use `..` not a colon.
- See also `docs/solutions/security-issues/jailed-filesystem-symlink-containment.md` — the other fix surfaced by the same benchmark harness.
