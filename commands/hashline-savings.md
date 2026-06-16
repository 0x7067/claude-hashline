---
description: Report hashline's estimated output-token savings for this project
---
Run the savings rollup for the current project and report it to the user, then add a one-line takeaway.

```bash
bun run "${CLAUDE_PLUGIN_ROOT:-.}/src/savings.ts" "${CLAUDE_PROJECT_DIR:-$PWD}"
```

Notes:
- The numbers are ESTIMATES (chars/4). Anthropic ships no exact local tokenizer for current Claude models, so present them as directional, not billable.
- "Saved" = estimated output tokens `str_replace` (the built-in editor's old_string + new_string) would have emitted, minus what the hashline patch actually emitted, summed over tracked edits. This is the realistic counterfactual, not a full-file `Write`.
- Rows written before the str_replace baseline landed are reported separately as inflated legacy and excluded from the headline total — they can't be recomputed. Expect the honest total to track the benchmark's measured 9-21%, not a far larger figure.
- If the rollup shows 0 edits, tell the user tracking starts from the first hashline edit after this feature landed (it is on by default; `HASHLINE_TRACK_SAVINGS=0` disables it).
