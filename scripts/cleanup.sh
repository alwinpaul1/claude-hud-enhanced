#!/bin/bash
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
HUD_DIR="$HOME/.claude/hud"
EVENT_FIFO="$HUD_DIR/events/$SESSION_ID.fifo"
PID_FILE="$HUD_DIR/pids/$SESSION_ID.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  kill "$PID" 2>/dev/null || true
  rm -f "$PID_FILE"
fi

rm -f "$EVENT_FIFO"

exit 0
