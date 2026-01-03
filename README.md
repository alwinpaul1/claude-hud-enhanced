# Claude HUD

[![CI](https://github.com/jarrodwatts/claude-hud/actions/workflows/ci.yml/badge.svg)](https://github.com/jarrodwatts/claude-hud/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/jarrodwatts/claude-hud)](https://github.com/jarrodwatts/claude-hud/releases)

Real-time terminal dashboard for Claude Code. See context usage, tool activity, agent status, and more in a split pane next to your terminal.

## Quickstart (2 minutes)

```bash
claude /plugin install github.com/jarrodwatts/claude-hud
```

Start Claude Code as usual. The HUD appears automatically.

Verify installation (optional):

```bash
claude plugin validate claude-hud
```

Toggle visibility with `Ctrl+H`. Exit with `Ctrl+C`.

## LLM-Paste Overview (copy into your LLM)

```markdown
Project: Claude HUD

What it is:
- A Claude Code plugin that opens a real-time terminal HUD (Heads-Up Display) in a split pane.
- Shows context usage, tool activity, agent status, todos, git status, and cost estimation while Claude runs.

Why use it:
- Monitor token burn, compaction risk, and costs as you work.
- See tool calls and agent activity in real time without leaving your editor/terminal.
- Spot issues early (errors, stalls, runaway context growth).

How it works (Claude Code plugin model):
- Claude Code plugins are directories with a `.claude-plugin/plugin.json` manifest plus root-level feature folders.
- This plugin uses `hooks/hooks.json` to subscribe to Claude Code lifecycle events.
- Hook scripts in `scripts/` transform event payloads and stream them through a FIFO.
- The TUI (React + Ink) reads the FIFO and renders panels in a split pane.

Key components:
- `.claude-plugin/plugin.json`: plugin manifest and metadata.
- `hooks/hooks.json`: event subscriptions (SessionStart, PreToolUse, PostToolUse, etc).
- `scripts/session-start.sh`: creates FIFO and launches HUD.
- `scripts/capture-event.sh`: normalizes hook events and writes them to the FIFO.
- `tui/src/lib/event-reader.ts`: reads FIFO, emits events with reconnect.
- `tui/src/index.tsx`: top-level UI state and rendering.

Install (recommended):
- `claude /plugin install github.com/jarrodwatts/claude-hud`
- Start Claude Code as normal; HUD spawns automatically.

Verify:
- `claude plugin validate claude-hud`
- or `./scripts/verify-install.sh` (when installed from source)

Requirements:
- Claude Code (v1.0.33+)
- Node.js 18+ or Bun
- `jq` for hook JSON parsing

Supported terminals:
- tmux, iTerm2, Kitty, WezTerm, Zellij, Windows Terminal (WSL) for split panes.
- Others fall back to a separate window or background process.

Common troubleshooting:
- Set `CLAUDE_HUD_DEBUG=1` and run `claude` to see debug logs.
- Use `claude --debug hooks` to inspect hook activity.
- See `TROUBLESHOOTING.md` for more.

Summary:
- Claude HUD is a production-ready Claude Code plugin that streams hook events into a split-pane TUI so you can see context health, tool activity, and agent status live.
```

Prefer a standalone file? See `docs/LLM.md`.

## Docs

- `TROUBLESHOOTING.md`
- `CONTRIBUTING.md`
- `docs/CHANGELOG.md`
- `docs/FAQ.md`
- `docs/LLM.md`
- `docs/ARCHITECTURE.md`
- `docs/README.md`
- `CLAUDE.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `LICENSE`

## Features

### Context Health
The most important metric when working with AI. See at a glance:
- **Token count** with visual progress bar
- **Sparkline** showing token usage history
- **Burn rate** — tokens consumed per minute
- **Compaction warning** when context is getting full
- **Breakdown** of input vs output token usage

### Cost Estimation
Track your API costs in real-time:
- **Total cost** with input/output breakdown
- Automatically detects model pricing (Sonnet/Opus/Haiku)

### Tool Activity Stream
Watch Claude work in real-time:
- Every tool call with status icons (✓ complete, ◐ running, ✗ error)
- **Duration** for each operation
- **Smart path truncation** showing filename + parent
- Color-coded: green for success, yellow for running, red for errors

### Session Status
- **Idle indicator** (💤 idle / ⚡ working)
- **Permission mode** when not default
- **Compaction count** warnings
- **Last user prompt** preview

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

## How It Works

Claude HUD uses Claude Code's plugin hooks to capture events:

1. **SessionStart** — Spawns the HUD in a split pane
2. **PreToolUse** — Shows tools before execution (running state)
3. **PostToolUse** — Captures tool completion
4. **UserPromptSubmit** — Tracks user prompts
5. **Stop** — Detects idle state
6. **PreCompact** — Tracks context compaction
7. **SubagentStop** — Tracks agent completion
8. **SessionEnd** — Cleans up

Data flows through a named pipe (FIFO) to a React/Ink terminal UI.

## Plugin Anatomy (Claude Code)

Claude Code plugins are directories with a `.claude-plugin/plugin.json` manifest plus feature directories at the plugin root. In Claude HUD:
- `.claude-plugin/plugin.json` declares the plugin name/version and provides the namespace.
- `hooks/hooks.json` registers lifecycle event subscriptions.
- `scripts/` contains the hook entrypoints that receive event payloads.
- `tui/` contains the React/Ink HUD that renders streamed events.

## Configuration

- `CLAUDE_HUD_DEBUG=1` enables debug logging to stderr.

## Requirements

- Claude Code
- Node.js 18+ or Bun
- `jq` (for JSON parsing in hooks)

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

## Troubleshooting (Quick Checks)

```bash
# Check plugin is valid
claude plugin validate claude-hud

# Enable debug logging for the HUD
CLAUDE_HUD_DEBUG=1 claude

# View debug output
claude --debug hooks

# If installed from source, run verification script
./scripts/verify-install.sh
```

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

# Lint & typecheck
bun run lint
bun run typecheck

# Start manually (for development)
bun run start -- --session test --fifo /tmp/test.fifo
```

### Debug Mode

Set `CLAUDE_HUD_DEBUG=1` to enable detailed logging to stderr:

```bash
CLAUDE_HUD_DEBUG=1 bun run start -- --session test --fifo /tmp/test.fifo
```

## License

MIT

## Credits

Built with [Claude Code](https://claude.ai/code) and [Ink](https://github.com/vadimdemedes/ink).
