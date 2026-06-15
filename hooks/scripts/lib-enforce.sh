#!/usr/bin/env bash
# Shared enforcement decision for the hashline hooks (block-edit.sh + nudge.sh).
# Keeping it in one place stops the two hooks from drifting apart on the
# opt-out rules — they must agree, or the model gets nudged toward hashline in a
# repo where the block is actually off (or vice versa).
#
# hashline_enforced "<payload-json>"
#   returns 0  -> ENFORCE (deny built-ins / show the nudge)
#   returns 1  -> ALLOW   (this repo opted out)
#
# Enforcement is ON BY DEFAULT (R7). A globally enabled plugin therefore blocks
# the built-in editors everywhere unless a repo (or the operator) opts out. That
# is the explicit project choice; the cost is that other tools/skills which edit
# via the built-ins must be excluded per-repo. See the opt-out paths below.

hashline_enforced() {
  local payload="${1:-}"

  # Opt-out / kill-switch — any one of these ALLOWS the built-in editors:
  #
  #  1. HASHLINE_DISABLED env var, read fresh each call — the out-of-band
  #     recovery valve when the hashline edit tool itself is broken (the
  #     in-session agent can't, since Write is blocked).
  #  2. ~/.hashline-off — a HOME-trusted sentinel. Same recovery role, persists
  #     across sessions, and cannot be shipped by a cloned repo.
  if [ -n "${HASHLINE_DISABLED:-}" ] || [ -f "${HOME:-/nonexistent}/.hashline-off" ]; then
    return 1
  fi

  # 3. A .hashline-off marker at the workspace root or any ancestor — the
  #    per-project, committable opt-out (a team excludes a repo by checking the
  #    file in).
  #
  #    SECURITY TRADE-OFF (SEC-003, reopened deliberately): unlike the HOME
  #    sentinel, a cwd/ancestor marker CAN be shipped in a cloned repo or dropped
  #    by a prompt-injected agent (`touch .hashline-off`), silently disabling the
  #    block. The block is a workflow nudge, not a security boundary — the jailed
  #    MCP filesystem is the real boundary — so this is acceptable for the
  #    convenience of per-repo opt-out. Do NOT rely on the block to contain a
  #    hostile model.
  local dir
  dir="$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  [ -z "$dir" ] && dir="$PWD"
  while [ -n "$dir" ] && [ "$dir" != "/" ]; do
    if [ -e "$dir/.hashline-off" ]; then return 1; fi
    dir="$(dirname "$dir")"
  done

  # Default: enforce.
  return 0
}
