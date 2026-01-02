# Claude HUD

Real-time terminal dashboard for Claude Code. See context usage, tool activity, agent status, and more — all in a split pane next to your terminal.

![Claude HUD Screenshot](screenshot.png)

## Installation

```bash
claude /plugin install github.com/jarrodwatts/claude-hud
```

That's it. The HUD appears automatically when you start Claude Code.

## Features

### Context Health
The most important metric when working with AI. See at a glance:
- **Token count** with visual progress bar
- **Burn rate** — tokens consumed per minute
- **Compaction warning** when context is getting full
- **Breakdown** of input vs output token usage

### Tool Activity Stream
Watch Claude work in real-time:
- Every tool call with status icons (✓ complete, ◐ running, ✗ error)
- **Duration** for each operation
- **Smart path truncation** showing filename + parent
- Color-coded: green for success, yellow for running, red for errors

### Agent Tracking
When Claude spawns subagents:
- **Type and description** of each agent
- **Live elapsed time** counter
- **Nested tool calls** — see what the agent is doing
- Completion status

### Session Statistics
- Total tool call counts by type
- Lines changed (+additions/-deletions)
- Session duration
- Number of completed agents

### Additional Panels
- **Todo List** — Claude's current task tracking
- **Modified Files** — files changed this session
- **MCP Status** — connected MCP servers

## Supported Terminals

| Terminal | Split Support |
|----------|---------------|
| **tmux** | ✓ Native split pane |
| **iTerm2** | ✓ Native split |
| **Kitty** | ✓ Remote control split |
| **WezTerm** | ✓ CLI split pane |
| **Zellij** | ✓ Native split |
| **Windows Terminal** | ✓ WSL split |
| **macOS Terminal** | Separate window |
| **xterm (Linux)** | Separate window |
| **Others** | Background process |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+H` | Toggle HUD visibility |
| `Ctrl+C` | Exit HUD |

## How It Works

Claude HUD uses Claude Code's plugin hooks to capture events:

1. **SessionStart** — Spawns the HUD in a split pane
2. **PostToolUse** — Captures every tool call
3. **SubagentStop** — Tracks agent completion
4. **SessionEnd** — Cleans up

Data flows through a named pipe (FIFO) to a React/Ink terminal UI.

## Requirements

- Claude Code
- Node.js 18+ or Bun
- `jq` (for JSON parsing in hooks)

## Development

```bash
# Clone the repo
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud/tui

# Install dependencies
bun install

# Build
bun run build

# Run tests
bun test

# Start manually (for development)
bun run start -- --session test --fifo /tmp/test.fifo
```

## License

MIT

## Credits

Built with [Claude Code](https://claude.ai/code) and [Ink](https://github.com/vadimdemedes/ink).
