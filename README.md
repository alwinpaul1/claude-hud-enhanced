# Claude HUD

[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud)](LICENSE)

Real-time statusline HUD for Claude Code. See context usage, tool activity, agent status, and todo progress directly in your terminal.

```
[Opus] ████████░░ 45% | 📋 3 rules | 🔌 5 MCPs | ⏱️ 12m
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2
◐ explore [haiku]: Finding auth code (2m 15s)
▸ Fix authentication bug (2/5)
```

## Why?

When Claude shows "Thinking..." for minutes, you have no visibility into what's happening. Claude HUD gives you **X-ray vision**:

- **Context health** — See exactly how full your context window is (native, accurate data)
- **Tool activity** — Watch Claude read, edit, and search files in real-time
- **Agent tracking** — See which subagents are running and what they're doing
- **Todo progress** — Track task completion as Claude works

## Installation

```bash
claude /plugin install github.com/jarrodwatts/claude-hud
```

That's it. Start Claude Code as usual — the statusline appears automatically.

## What You See

### Line 1: Session Info
```
[Opus] ████████░░ 45% | 📋 3 rules | 🔌 5 MCPs | ⏱️ 12m
```
- **Model** — Current model (Opus, Sonnet, Haiku)
- **Context bar** — Visual progress with color coding:
  - 🟢 Green: <70% (healthy)
  - 🟡 Yellow: 70-85% (getting full)
  - 🔴 Red: >85% (warning) — shows token breakdown
  - ⚠️ COMPACT: >95% (critical)
- **Rules count** — How many CLAUDE.md files loaded
- **MCP count** — Connected MCP servers
- **Duration** — Session time

### Line 2: Tool Activity
```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2
```
- **Running tools** with ◐ spinner and target file
- **Completed tools** aggregated by type with counts

### Line 3: Agent Status (when active)
```
◐ explore [haiku]: Finding auth code (2m 15s)
```
- **Agent type** and model
- **Description** of what it's doing
- **Elapsed time**

### Line 4: Todo Progress (when todos exist)
```
▸ Fix authentication bug (2/5)
```
- **Current task** being worked on
- **Progress** (completed/total)

## How It Works

Claude HUD uses Claude Code's **statusline API** — a multi-line display that updates every ~300ms.

Unlike other approaches, Claude HUD:
- **No separate window** — Displays inline in your terminal
- **No hooks needed** — Parses the transcript directly
- **Native data** — Gets accurate token/context info from Claude Code
- **Works everywhere** — Any terminal, not just tmux/iTerm

### Architecture

```
Claude Code → stdin JSON (model, tokens, context)
           → transcript JSONL (tools, agents, todos)
           → claude-hud renders 4 lines
           → Claude Code displays them
```

## Requirements

- Claude Code v1.0.80+
- Node.js 18+ or Bun

## Configuration

Claude HUD works with zero configuration. Optionally customize via `~/.claude/hud/config.json`:

```json
{
  "showRules": true,
  "showMcps": true,
  "showDuration": true,
  "contextWarningThreshold": 85,
  "contextCriticalThreshold": 95
}
```

## Development

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud

# Install & build
bun install
bun run build

# Test with sample data
echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000}}' | node dist/index.js
```

## License

MIT

## Credits

Built with [Claude Code](https://claude.ai/code).

---

**v2.0** — Complete rewrite from split-pane TUI to inline statusline. [See v1 for the original split-pane version](https://github.com/jarrodwatts/claude-hud/tree/v1.0.0-split-pane).
