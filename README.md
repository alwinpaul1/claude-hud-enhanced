# Claude HUD 🖥️

Real-time terminal HUD (Heads-Up Display) for Claude Code. Shows context usage, tool activity, MCP status, todos, and modified files in a split pane.

![Claude HUD Screenshot](screenshot.png)

## Features

- **Context Meter** - Live token count, percentage, and remaining context
- **Tool Stream** - Real-time feed of all tool calls with status
- **MCP Status** - Connected MCP server indicators
- **Todo List** - Current tasks with progress highlighting
- **Modified Files** - Files changed during the session

## Installation

```bash
claude /plugin install github.com/jarrod/claude-hud
```

The plugin will automatically:
1. Install dependencies on first run (bun preferred, falls back to npm)
2. Build the TUI
3. Create a split pane in your terminal

## Supported Terminals

| Terminal | Split Support |
|----------|--------------|
| tmux | Native split pane |
| iTerm2 | Native split (AppleScript) |
| Kitty | Native split (remote control) |
| WezTerm | Native split (CLI) |
| Zellij | Native split |
| Windows Terminal | Native split (WSL) |
| macOS Terminal | Companion window |
| Others | Background process |

## Usage

Once installed, the HUD appears automatically when you start Claude Code.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+H` | Toggle HUD visibility |
| `Ctrl+C` | Exit HUD |

## Configuration

The HUD uses sensible defaults. Future versions will support configuration via `.claude/claude-hud.local.md`.

## How It Works

1. **SessionStart hook** - Spawns the HUD TUI in a terminal split pane
2. **PostToolUse hook** - Captures all tool calls and writes to a FIFO
3. **SubagentStop hook** - Tracks subagent completion
4. **SessionEnd hook** - Cleans up the HUD process and FIFO

Data flows from Claude Code hooks → FIFO → HUD TUI (React/Ink).

## Development

```bash
cd tui
bun install
bun run build
bun run start -- --session test --fifo /tmp/test.fifo
```

## Requirements

- Claude Code
- Node.js 18+ or Bun
- jq (for JSON parsing in hooks)

## License

MIT
