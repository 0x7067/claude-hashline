#!/usr/bin/env bash
# PreToolUse hook: redirect built-in Edit/Write/NotebookEdit to the hashline edit
# tool (R7) — but ONLY where a project has opted into enforcement. A globally
# enabled plugin must be safe everywhere: blocking the built-in editors in every
# repo would break any tool or skill that edits files. So the default is
# fail-open; enforcement is opt-in.
set -euo pipefail

# Capture the PreToolUse payload (also drains stdin so the caller never sees a
# broken pipe).
payload="$(cat 2>/dev/null || true)"

# Disable kill-switch (highest precedence; human-operated, out-of-band, R9):
#  - HASHLINE_DISABLED env var, read fresh each call, to unblock a live session.
#  - a sentinel in a TRUSTED dir (HOME), never cwd — a cwd sentinel would be
#    model-spoofable and a cloned repo could ship one (SEC-003).
if [ -n "${HASHLINE_DISABLED:-}" ] || [ -f "${HOME:-/nonexistent}/.hashline-off" ]; then
  exit 0
fi

# Enforcement is OPT-IN (global-safe default). Block only when:
#  - HASHLINE_ENFORCE is set (session/global opt-in), or
#  - a `.hashline-enforce` marker exists at the workspace root or any ancestor
#    (per-project opt-in; committable for a team).
# A cwd marker can only ADD restriction, never bypass, so it is not a spoofing
# risk — the disable path above stays HOME-only.
enforce=""
if [ -n "${HASHLINE_ENFORCE:-}" ]; then
  enforce=1
else
  dir="$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  [ -z "$dir" ] && dir="$PWD"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -e "$dir/.hashline-enforce" ]; then enforce=1; break; fi
    dir="$(dirname "$dir")"
  done
fi

# Not opted in -> allow the built-in edit (fail-open).
if [ -z "$enforce" ]; then
  exit 0
fi

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Built-in Edit/Write/NotebookEdit are disabled in this hashline-enforced project. Use the hashline edit tool (mcp__plugin_claude-hashline_hashline__edit): read the file to get its [PATH#TAG], then send line-anchored ops (replace N..M:, insert after N:, delete N..M). Create a file with a tagless [path] header + insert head: body. To turn enforcement off: remove .hashline-enforce, or set HASHLINE_DISABLED=1, or create ~/.hashline-off."}}
JSON
