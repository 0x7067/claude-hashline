#!/usr/bin/env bash
# SessionStart hook: positive reinforcement. Where hashline enforcement is active,
# steer the model toward the hashline edit tool up front, so it doesn't waste a
# turn reaching for the (blocked) built-in editors first. Silent where the repo
# has opted out — same decision as block-edit.sh, shared via lib-enforce.sh.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-enforce.sh
. "$DIR/lib-enforce.sh"

payload="$(cat 2>/dev/null || true)"

# Opted out -> no nudge.
hashline_enforced "$payload" || exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"This workspace enforces hashline editing: the built-in Edit, Write, and NotebookEdit tools are BLOCKED here. Use the hashline edit tool (mcp__plugin_claude-hashline_hashline__edit) for every file change — read a file to get its [PATH#TAG], then send line-anchored ops (replace N..M:, insert after N:, delete N..M); create a file with a tagless [path] header + insert head: body. When searching for code you intend to change, use the hashline search tool (mcp__plugin_claude-hashline_hashline__search) instead of Grep — it returns the same [PATH#TAG] format so you can edit straight off a hit, no read first. Built-in Read and Grep stay available for plain exploration. To opt this repo out, add a .hashline-off file at the repo root."}}
JSON
