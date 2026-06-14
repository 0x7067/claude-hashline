---
name: benchmark-report
description: Generate the hashline benchmark report — print a summarized ASCII table and key takeaways in the terminal, and save a full markdown analysis to a file. Use after a bench/run.ts sweep completes, or when the user asks to "show/generate the benchmark report", "analyze the benchmark", or "summarize the sweep".
---

# Hashline benchmark report

Turn a completed sweep (`report.md` from `bench/run.ts`) into (1) a compact
ASCII summary + key takeaways shown inline in Claude Code, and (2) a full
markdown analysis saved to a dated file. The deterministic work lives in
`bench/analyze.ts`; this skill runs it and adds honest interpretation.

## Steps

1. **Find the source report.** Default `report.md` at the repo root. If the
   user names a different file (e.g. an archived `report.buggy-jail.md`), use
   that. If `report.md` is missing, tell the user to run a sweep first
   (`bun run bench/run.ts <fixtures> --models … --out report.md`) — do not
   fabricate numbers.

2. **Run the analyzer.** Save the full report under `docs/benchmark/` with
   today's date:

   ```bash
   bun run bench/analyze.ts report.md --out docs/benchmark/<YYYY-MM-DD>-hashline-analysis.md
   ```

   - It auto-detects the most recent `hashline-bench-*` transcript root to
     classify the hashline arm's edit-failures (genuine rejection vs
     blocked-built-in vs jail path-rejection). To pin a specific sweep, pass
     `--classify hashline-bench-XXXX`; to skip classification, pass
     `--classify none`.
   - The command prints the ASCII summary + takeaways to stdout and writes the
     full markdown file.

3. **Show the summary inline.** Relay the ASCII tables (raw cells + the
   hashline-vs-control delta table) and the bulleted key takeaways the analyzer
   printed. Keep them verbatim — they are the deterministic result.

4. **Add interpretation (judgment, not invented numbers).** In 2-4 sentences:
   - State whether hashline helped, hurt, or washed out, per tier.
   - If the edit-failure classification shows a non-trivial **jail
     path-rejection** share, flag that those are adapter artifacts, not the
     hashline format — recommend a re-run after the jail fix if the run predates
     `src/jailed-fs.ts` realpath canonicalization.
   - Always restate the **confound** (hashline vs control differ on edit-format
     AND training familiarity) and **sample size** honestly. Do not overclaim
     from small per-cell n; call single-fixture cells anecdotes.

5. **Confirm the saved file.** Report the path of the full analysis written
   under `docs/benchmark/`.

## Notes

- The analyzer is read-only over `report.md` and `~/.claude/projects`
  transcripts; it never re-runs the model.
- `masked` > 0 in the hashline arm is a red flag (the formatter oracle hid a
  raw whitespace/indent deviation — adv-05); surface it prominently if present.
- Token/turn deltas are the efficiency signal; pass rate is the correctness
  signal. Report both, and note when they disagree.
