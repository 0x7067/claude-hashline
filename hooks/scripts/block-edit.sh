#!/usr/bin/env bash
# PreToolUse hook: deny built-in Edit/Write/NotebookEdit so the model must use
# the hashline edit tool (R7). The matcher in hooks.json already restricts this
# to those tools, so the denial is unconditional unless the escape hatch is
# engaged.
set -euo pipefail

# Drain stdin (the PreToolUse payload) so the caller never sees a broken pipe.
cat >/dev/null 2>&1 || true

# Escape hatch (R9), human-operated and out-of-band:
#  - HASHLINE_DISABLED env var, read fresh on every invocation, so an operator
#    can unblock a running session without restart.
#  - a sentinel file in a TRUSTED dir (HOME), never cwd — a cwd sentinel would
#    be model-spoofable and a cloned repo could ship one (SEC-003).
if [ -n "${HASHLINE_DISABLED:-}" ] || [ -f "${HOME:-/nonexistent}/.hashline-off" ]; then
  exit 0
fi

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Built-in Edit/Write/NotebookEdit are disabled by claude-hashline. Use the hashline edit tool (mcp__plugin_claude-hashline_hashline__edit): read the file to get its [PATH#TAG], then send line-anchored ops (replace N..M:, insert after N:, delete N..M). To create a file, send a tagless [path] header with an insert head: body. To disable this block, set HASHLINE_DISABLED=1 or create ~/.hashline-off."}}
JSON
