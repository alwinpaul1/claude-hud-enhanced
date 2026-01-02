# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude HUD is a Claude Code plugin that displays a real-time terminal HUD (Heads-Up Display) in a split pane. It shows context usage, tool activity, MCP status, todos, and modified files.

## Build Commands

```bash
# Install dependencies and build
cd tui && bun install && bun run build

# Development with watch mode
cd tui && bun run dev

# Run the TUI manually (for testing)
cd tui && bun run start -- --session test --fifo /tmp/test.fifo
```

## Architecture

### Data Flow

```
Claude Code Hooks → FIFO (named pipe) → EventReader → React/Ink TUI
```

1. **Hooks** (`hooks/hooks.json`) register shell scripts for Claude Code lifecycle events
2. **Scripts** (`scripts/*.sh`) capture events and write JSON to a session-specific FIFO
3. **EventReader** (`tui/src/lib/event-reader.ts`) reads the FIFO and emits parsed events
4. **App** (`tui/src/index.tsx`) processes events and updates React state

### Hook Events Captured

- `SessionStart`: Spawns the HUD TUI in a terminal split pane
- `PostToolUse`: Captures all tool calls (TodoWrite, Edit, Write, Task, etc.)
- `SubagentStop`: Tracks agent completion
- `SessionEnd`: Cleanup (kills process, removes FIFO)

### TUI Structure

- `tui/src/index.tsx` - Main app, processes HudEvent and manages all state
- `tui/src/lib/types.ts` - Type definitions (HudEvent, ToolEntry, TodoItem, etc.)
- `tui/src/lib/event-reader.ts` - FIFO reader with auto-reconnect
- `tui/src/components/` - React/Ink components for each HUD section

### Session Files

Runtime files are stored in `~/.claude/hud/`:
- `events/<session_id>.fifo` - Named pipe for event streaming
- `pids/<session_id>.pid` - Process ID for cleanup
- `logs/<session_id>.log` - Fallback output when no split pane available

## Dependencies

- **Runtime**: Node.js 18+ or Bun, jq (JSON parsing in hooks)
- **TUI Framework**: React + Ink (terminal UI)
- **Build**: TypeScript targeting ES2022 with NodeNext modules
