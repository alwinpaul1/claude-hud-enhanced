#!/bin/bash
set -e

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}"
HUD_DIR="$HOME/.claude/hud"
EVENT_FIFO="$HUD_DIR/events/$SESSION_ID.fifo"
PID_FILE="$HUD_DIR/pids/$SESSION_ID.pid"

mkdir -p "$HUD_DIR/events" "$HUD_DIR/logs" "$HUD_DIR/pids"

rm -f "$EVENT_FIFO"
mkfifo "$EVENT_FIFO"

if [ ! -d "$PLUGIN_ROOT/tui/node_modules" ]; then
  cd "$PLUGIN_ROOT/tui" && bun install --silent 2>/dev/null || npm install --silent 2>/dev/null || true
fi

if [ ! -f "$PLUGIN_ROOT/tui/dist/index.js" ]; then
  cd "$PLUGIN_ROOT/tui" && bun run build 2>/dev/null || npm run build 2>/dev/null || true
fi

HUD_CMD="bun $PLUGIN_ROOT/tui/dist/index.js --session $SESSION_ID --fifo $EVENT_FIFO"

create_split_pane() {
  if [ -n "$TMUX" ]; then
    tmux split-window -h -l 45 "$HUD_CMD"
    return 0
  fi

  if [ "$TERM_PROGRAM" = "iTerm.app" ]; then
    osascript -e "
      tell application \"iTerm2\"
        tell current session of current window
          split vertically with default profile command \"$HUD_CMD\"
        end tell
      end tell
    " 2>/dev/null
    return 0
  fi

  if [ -n "$KITTY_PID" ]; then
    kitty @ launch --location=vsplit --cwd=current $HUD_CMD 2>/dev/null
    return 0
  fi

  if [ "$TERM_PROGRAM" = "WezTerm" ]; then
    wezterm cli split-pane --right --percent 30 -- $HUD_CMD 2>/dev/null
    return 0
  fi

  if [ -n "$ZELLIJ" ]; then
    zellij run -f -- $HUD_CMD 2>/dev/null
    return 0
  fi

  if [ -n "$WT_SESSION" ]; then
    wt.exe -w 0 sp -H -s 0.3 wsl.exe $HUD_CMD 2>/dev/null
    return 0
  fi

  if [ "$(uname)" = "Darwin" ]; then
    osascript -e "
      tell application \"Terminal\"
        do script \"$HUD_CMD\"
        set bounds of front window to {800, 100, 1200, 800}
      end tell
    " 2>/dev/null
    return 0
  fi

  nohup $HUD_CMD > "$HUD_DIR/logs/$SESSION_ID.log" 2>&1 &
  echo $! > "$PID_FILE"
}

create_split_pane

exit 0
