#!/bin/bash
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
EVENT_FIFO="$HOME/.claude/hud/events/$SESSION_ID.fifo"

if [ -p "$EVENT_FIFO" ]; then
  echo "$INPUT" | jq -c '{
    event: .hook_event_name,
    tool: .tool_name,
    input: .tool_input,
    response: .tool_response,
    session: .session_id,
    ts: (now | floor)
  }' >> "$EVENT_FIFO" 2>/dev/null || true
fi

exit 0
