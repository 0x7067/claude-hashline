#!/usr/bin/env bash
# Example hook script for claude-hashline.
# Hook input arrives as JSON on stdin; emit JSON on stdout to influence behavior.
# $CLAUDE_PLUGIN_ROOT points at the installed plugin root.
set -euo pipefail

# Read the hook payload (no-op passthrough by default).
cat >/dev/null

exit 0
