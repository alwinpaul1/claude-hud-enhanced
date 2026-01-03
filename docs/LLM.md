# Claude HUD: LLM-Paste Overview

Copy the block below into your LLM of choice.

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
