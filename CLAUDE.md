# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Claude HUD is a Claude Code plugin that displays a real-time multi-line statusline. It shows context health, tool activity, agent status, and todo progress.

## Build Commands

```bash
npm ci               # Install dependencies
npm run build        # Build TypeScript to dist/

# Test with sample stdin data
echo '{"model":{"display_name":"Opus"},"context_window":{"current_usage":{"input_tokens":45000},"context_window_size":200000}}' | node dist/index.js
```

## Architecture

### Data Flow

```
Claude Code → stdin JSON → parse → render lines → stdout → Claude Code displays
           ↘ transcript_path → parse JSONL → tools/agents/todos
```

**Key insight**: The statusline is invoked every ~300ms by Claude Code. Each invocation:
1. Receives JSON via stdin (model, context, tokens - native accurate data)
2. Parses the transcript JSONL file for tools, agents, and todos
3. Renders multi-line output to stdout
4. Claude Code displays all lines

### Data Sources

**Native from stdin JSON** (accurate, no estimation):
- `model.display_name` - Current model
- `context_window.current_usage` - Token counts
- `context_window.context_window_size` - Max context
- `transcript_path` - Path to session transcript

**From transcript JSONL parsing**:
- `tool_use` blocks → tool name, input, start time
- `tool_result` blocks → completion, duration
- Running tools = `tool_use` without matching `tool_result`
- `TodoWrite` calls → todo list
- `Task` calls → agent info

**From config files**:
- MCP count from `~/.claude/settings.json` (mcpServers)
- Hooks count from `~/.claude/settings.json` (hooks)
- Rules count from CLAUDE.md files

**From OAuth credentials** (`~/.claude/.credentials.json`, when `display.showUsage` enabled):
- `claudeAiOauth.accessToken` - OAuth token for API calls
- `claudeAiOauth.subscriptionType` - User's plan (Pro, Max, Team)

**From Anthropic Usage API** (`api.anthropic.com/api/oauth/usage`):
- 5-hour and 7-day usage percentages
- Reset timestamps (cached 60s success, 15s failure)

### File Structure

```
src/
├── index.ts           # Entry point
├── stdin.ts           # Parse Claude's JSON input
├── transcript.ts      # Parse transcript JSONL
├── config-reader.ts   # Read MCP/rules configs
├── config.ts          # Load/validate user config
├── git.ts             # Git status (branch, dirty, ahead/behind)
├── usage-api.ts       # Fetch usage from Anthropic API
├── types.ts           # TypeScript interfaces
└── render/
    ├── index.ts       # Main render coordinator
    ├── session-line.ts   # Line 1: model, context, project, git, usage
    ├── tools-line.ts     # Line 2: tool activity
    ├── agents-line.ts    # Line 3: agent status
    ├── todos-line.ts     # Line 4: todo progress
    └── colors.ts         # ANSI color helpers
```

### Output Format

```
[Opus | Pro] █████░░░░░ 45% | my-project git:(main) | 2 CLAUDE.md | 5h: 25% | ⏱️ 5m
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2
◐ explore [haiku]: Finding auth code (2m 15s)
▸ Fix authentication bug (2/5)
```

Lines are conditionally shown:
- Line 1 (session): Always shown
- Line 2 (tools): Shown if any tools used
- Line 3 (agents): Shown only if agents active
- Line 4 (todos): Shown only if todos exist

### Context Thresholds

| Threshold | Color | Action |
|-----------|-------|--------|
| <70% | Green | Normal |
| 70-85% | Yellow | Warning |
| >85% | Red | Show token breakdown |

## Plugin Configuration

The plugin manifest is in `.claude-plugin/plugin.json` (metadata only - name, description, version, author).

**StatusLine configuration** must be added to the user's `~/.claude/settings.json` via `/claude-hud:setup`.

The setup command adds an auto-updating command that finds the latest installed version at runtime.

Note: `statusLine` is NOT a valid plugin.json field. It must be configured in settings.json after plugin installation. Updates are automatic - no need to re-run setup.

## Dependencies

- **Runtime**: Node.js 18+ or Bun
- **Build**: TypeScript 5, ES2022 target, NodeNext modules
