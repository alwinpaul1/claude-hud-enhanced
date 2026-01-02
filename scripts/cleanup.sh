#!/bin/bash
set -uo pipefail

command -v jq &>/dev/null || exit 0

INPUT=$(cat)

if ! echo "$INPUT" | jq empty 2>/dev/null; then
  exit 0
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [[ -z "$SESSION_ID" || ! "$SESSION_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  exit 0
fi

HUD_DIR="$HOME/.claude/hud"
EVENT_FIFO="$HUD_DIR/events/$SESSION_ID.fifo"

# Only clean up the FIFO, not the HUD process
# HUD persists across sessions for /new and /resume
rm -f "$EVENT_FIFO"

exit 0
