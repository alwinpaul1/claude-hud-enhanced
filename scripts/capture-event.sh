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

EVENT_FIFO="$HOME/.claude/hud/events/$SESSION_ID.fifo"
HUD_DIR="$HOME/.claude/hud"
REFRESH_FILE="$HUD_DIR/refresh.json"

# Update refresh.json with transcriptPath when available (for session resume)
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$REFRESH_FILE" ]; then
  # Only update if this session matches the current refresh.json session
  CURRENT_SESSION=$(jq -r '.sessionId // empty' "$REFRESH_FILE" 2>/dev/null)
  if [ "$CURRENT_SESSION" = "$SESSION_ID" ]; then
    jq --arg tp "$TRANSCRIPT_PATH" '.transcriptPath = $tp' "$REFRESH_FILE" > "$REFRESH_FILE.tmp" && mv "$REFRESH_FILE.tmp" "$REFRESH_FILE"
  fi
fi

if [ -p "$EVENT_FIFO" ]; then
  EVENT_JSON=$(echo "$INPUT" | jq -c '{
    event: .hook_event_name,
    tool: .tool_name,
    toolUseId: .tool_use_id,
    input: .tool_input,
    response: .tool_response,
    session: .session_id,
    permissionMode: .permission_mode,
    transcriptPath: .transcript_path,
    cwd: .cwd,
    prompt: .prompt,
    ts: (now | floor)
  }' 2>/dev/null) || true

  if [ -n "$EVENT_JSON" ]; then
    # Non-blocking write using read-write mode (prevents blocking on unread FIFOs)
    exec 3<>"$EVENT_FIFO" 2>/dev/null && {
      echo "$EVENT_JSON" >&3 2>/dev/null || true
      exec 3>&-
    } || true
  fi
fi

exit 0
