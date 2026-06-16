---
description: Report hashline's estimated output-token savings for this project
---
Run the savings rollup for the current project and report it to the user, then add a one-line takeaway.

```bash
bun run "${CLAUDE_PLUGIN_ROOT:-.}/src/savings.ts" "${CLAUDE_PROJECT_DIR:-$PWD}"
```

Notes:
- The numbers are ESTIMATES (chars/4). Anthropic ships no exact local tokenizer for current Claude models, so present them as directional, not billable.
- "Saved" = estimated output tokens a full-file Write would have emitted, minus what the hashline patch actually emitted, summed over every tracked edit.
- If the rollup shows 0 edits, tell the user tracking starts from the first hashline edit after this feature landed (it is on by default; `HASHLINE_TRACK_SAVINGS=0` disables it).
