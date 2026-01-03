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
PID_FILE="$HUD_DIR/pids/$SESSION_ID.pid"
REFRESH_FILE="$HUD_DIR/refresh.json"

# Only close the HUD if this session is still the active one.
# This keeps HUD alive for /new while closing on /exit or terminal close.
if [ -f "$REFRESH_FILE" ]; then
  CURRENT_SESSION=$(jq -r '.sessionId // empty' "$REFRESH_FILE" 2>/dev/null)
  if [ "$CURRENT_SESSION" = "$SESSION_ID" ]; then
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE" 2>/dev/null)
      if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null || true
      fi
    fi
  fi
fi

# Clean up FIFO and pid file for this session
rm -f "$EVENT_FIFO"
rm -f "$PID_FILE"

exit 0
