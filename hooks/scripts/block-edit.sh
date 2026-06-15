#!/usr/bin/env bash
# PreToolUse hook: redirect built-in Edit/Write/NotebookEdit to the hashline edit
# tool (R7). Enforcement is ON BY DEFAULT — a globally enabled plugin blocks the
# built-in editors in every repo unless that repo (or the operator) has opted
# out. The opt-out rules live in lib-enforce.sh so this hook and the SessionStart
# nudge stay in agreement.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-enforce.sh
. "$DIR/lib-enforce.sh"

# Capture the PreToolUse payload (also drains stdin so the caller never sees a
# broken pipe). lib-enforce.sh parses the cwd out of it.
payload="$(cat 2>/dev/null || true)"

# Opted out -> allow the built-in edit.
if ! hashline_enforced "$payload"; then
  exit 0
fi

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Built-in Edit/Write/NotebookEdit are disabled by the hashline plugin. Use the hashline edit tool (mcp__plugin_claude-hashline_hashline__edit): read the file to get its [PATH#TAG], then send line-anchored ops (replace N..M:, insert after N:, delete N..M). Create a file with a tagless [path] header + insert head: body. To opt this repo out: add a .hashline-off file at the repo root, or set HASHLINE_DISABLED=1, or create ~/.hashline-off."}}
JSON
