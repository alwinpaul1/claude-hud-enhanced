#!/bin/bash
set -uo pipefail

command -v jq &>/dev/null || { echo "jq required" >&2; exit 1; }

INPUT=$(cat)

if ! echo "$INPUT" | jq empty 2>/dev/null; then
  exit 1
fi

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
if [[ -z "$SESSION_ID" || ! "$SESSION_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  exit 1
fi
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
HUD_DIR="$HOME/.claude/hud"
EVENT_FIFO="$HUD_DIR/events/$SESSION_ID.fifo"
PID_FILE="$HUD_DIR/pids/$SESSION_ID.pid"
LOG_FILE="$HUD_DIR/logs/$SESSION_ID.log"

mkdir -p "$HUD_DIR/events" "$HUD_DIR/logs" "$HUD_DIR/pids"

REFRESH_FILE="$HUD_DIR/refresh.json"

rm -f "$EVENT_FIFO"
mkfifo "$EVENT_FIFO"

if [ ! -d "$PLUGIN_ROOT/tui/node_modules" ]; then
  cd "$PLUGIN_ROOT/tui"
  if command -v bun &> /dev/null; then
    bun install --silent 2>/dev/null || true
  elif command -v npm &> /dev/null; then
    npm install --silent 2>/dev/null || true
  fi
fi

if [ ! -f "$PLUGIN_ROOT/tui/dist/index.js" ]; then
  cd "$PLUGIN_ROOT/tui"
  if command -v bun &> /dev/null; then
    bun run build 2>/dev/null || true
  elif command -v npm &> /dev/null; then
    npm run build 2>/dev/null || true
  fi
fi

if command -v bun &> /dev/null; then
  HUD_CMD="bun $PLUGIN_ROOT/tui/dist/index.js --session $SESSION_ID --fifo $EVENT_FIFO"
else
  HUD_CMD="node $PLUGIN_ROOT/tui/dist/index.js --session $SESSION_ID --fifo $EVENT_FIFO"
fi

find_existing_hud() {
  # Find existing HUD process PID that's actually visible
  for pid_file in "$HUD_DIR/pids"/*.pid; do
    [ -f "$pid_file" ] || continue
    local pid
    pid=$(cat "$pid_file" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      # Verify the process is in a visible tmux pane (if in tmux)
      if [ -n "${TMUX:-}" ]; then
        if tmux list-panes -a -F '#{pane_pid}' 2>/dev/null | grep -q "^${pid}$"; then
          echo "$pid"
          return 0
        else
          # Process exists but pane is gone - kill stale process
          kill "$pid" 2>/dev/null
          rm -f "$pid_file"
          continue
        fi
      else
        echo "$pid"
        return 0
      fi
    fi
    rm -f "$pid_file"
  done
  # Try pgrep as fallback - but only if pane is visible
  local fallback_pid
  fallback_pid=$(pgrep -f "tui/dist/index.js.*--session" 2>/dev/null | head -1)
  if [ -n "$fallback_pid" ] && [ -n "${TMUX:-}" ]; then
    if tmux list-panes -a -F '#{pane_pid}' 2>/dev/null | grep -q "^${fallback_pid}$"; then
      echo "$fallback_pid"
      return 0
    else
      kill "$fallback_pid" 2>/dev/null
    fi
  elif [ -n "$fallback_pid" ]; then
    echo "$fallback_pid"
  fi
}

signal_existing_hud() {
  local pid="$1"
  # Write refresh file with new session info
  cat > "$REFRESH_FILE" << EOF
{"sessionId":"$SESSION_ID","fifoPath":"$EVENT_FIFO"}
EOF
  # Send SIGUSR1 to trigger refresh
  kill -USR1 "$pid" 2>/dev/null
  # Save new PID file for this session
  echo "$pid" > "$PID_FILE"
}

launch_split_pane() {
  # Check for existing HUD - signal it instead of spawning new one
  local existing_pid
  existing_pid=$(find_existing_hud)
  if [ -n "$existing_pid" ]; then
    signal_existing_hud "$existing_pid"
    return 0
  fi

  # tmux - most reliable split pane support
  if [ -n "${TMUX:-}" ]; then
    tmux split-window -d -h -l 48 "$HUD_CMD" 2>/dev/null && return 0
  fi

  # iTerm2 on macOS
  if [ "${TERM_PROGRAM:-}" = "iTerm.app" ]; then
    osascript -e "
      tell application \"iTerm2\"
        tell current session of current window
          split vertically with default profile command \"$HUD_CMD\"
        end tell
      end tell
    " 2>/dev/null && return 0
  fi

  # Kitty terminal
  if [ -n "${KITTY_PID:-}" ]; then
    kitty @ launch --location=vsplit --cwd=current $HUD_CMD 2>/dev/null && return 0
  fi

  # WezTerm
  if [ "${TERM_PROGRAM:-}" = "WezTerm" ]; then
    wezterm cli split-pane --right --percent 25 -- $HUD_CMD 2>/dev/null && return 0
  fi

  # Zellij
  if [ -n "${ZELLIJ:-}" ]; then
    zellij run -f -- $HUD_CMD 2>/dev/null && return 0
  fi

  # Windows Terminal (WSL)
  if [ -n "${WT_SESSION:-}" ]; then
    wt.exe -w 0 sp -H -s 0.25 wsl.exe $HUD_CMD 2>/dev/null && return 0
  fi

  # macOS Terminal.app - open in new window
  if [ "$(uname)" = "Darwin" ] && [ "${TERM_PROGRAM:-}" = "Apple_Terminal" ]; then
    osascript -e "
      tell application \"Terminal\"
        do script \"$HUD_CMD\"
        set bounds of front window to {100, 100, 500, 600}
      end tell
    " 2>/dev/null && return 0
  fi

  # Linux with xterm available - open in new window
  if [ "$(uname)" = "Linux" ] && command -v xterm &> /dev/null; then
    xterm -geometry 48x40 -e "$HUD_CMD" &
    echo $! > "$PID_FILE"
    return 0
  fi

  # Fallback: run in background with logging
  nohup $HUD_CMD > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  return 0
}

launch_split_pane

exit 0
