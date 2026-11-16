# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Claude HUD is a Claude Code plugin that displays a real-time multi-line statusline. It shows context health, tool activity, agent status, and todo progress.

## Build Commands

```bash
cd plugins/claude-hud-enhanced
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

**Key insight**: The statusline is invoked by Claude Code on conversation events
(new assistant message, `/compact`, permission-mode/vim-mode change), debounced
at 300ms — plus on a fixed timer while idle when `statusLine.refreshInterval` is
set (setup benchmarks the render and writes `2`, `5`, or `10` — fastest the
machine can afford). Without `refreshInterval` the triggers go quiet while
idle and the HUD freezes at its last render. Each invocation:
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

**From Claude Code auth profile** (`{CLAUDE_CONFIG_DIR}.json` `oauthAccount`, via `auth.ts`):
- Plan / org tier label (e.g. Claude Max 20x) when `display.showAuth` is on
- Optional account user segment when `display.showAuthUser` is on

**From stdin `rate_limits`** (native Claude Code usage, as of that session's last request):
- 5-hour and 7-day usage percentages + reset timestamps
- Merged with the usage API reading in `usage-snapshot.json` (`display.oauthUsagePoll`, on by default): the API is the source of truth for which windows exist, stdin keeps the figure moving between polls
- Tests never reach the network or the real config dirs: every test file imports `tests/helpers/isolate-env.mjs` first (temp HOME, no CLAUDE_CONFIG_DIR, stub `gh`/`security`, fs + fetch guard)
- Optional external usage snapshot (`external-usage.ts`) for fallback paths

**HUD data directory** (config + caches + statusline launcher):
- `${CLAUDE_CONFIG_DIR:-~/.claude}/plugins/claude-hud-enhanced/`
- Auto-migrates legacy `plugins/claude-hud/` on first run / setup

### File Structure

```
src/
├── index.ts              # Entry point
├── stdin.ts              # Parse Claude's JSON input (incl. rate_limits)
├── transcript.ts         # Parse transcript JSONL
├── config-reader.ts      # Read MCP/rules configs
├── config.ts             # Load/validate user config
├── claude-config-dir.ts  # Config-dir + HUD data-dir resolution / migrate
├── auth.ts               # Plan/auth segment from Claude Code oauth account
├── external-usage.ts     # Optional external usage snapshot
├── usage-snapshot.ts     # Shared per-profile usage snapshot + refresher lock (atomic writes)
├── usage-hybrid.ts       # resolveUsage: merges stdin and the snapshot per window (newest reading wins, stdin only moves a figure forward), spawns refresher
├── refresh-usage.ts      # Detached OAuth usage refresher (token read-only → oauth/usage; one request per account, Retry-After, backoff)
├── extra-usage.ts        # Extra-usage spend from the API's extra_usage (minor units → amount, shown only while in use)
├── idle-usage-reset.ts   # Local window-rollover reset while idle (no network)
├── effort.ts             # Effort level (when Claude Code exposes it)
├── git.ts                # Git status (branch, dirty, ahead/behind)
├── git-cache.ts          # TTL+mtime persistent cache around git.ts (spawn-storm fix)
├── pr-status.ts          # PR snapshot + parsers for the pill row (gh output, checks, base)
├── refresh-pr.ts         # Detached gh/git refresher that writes the PR snapshot
├── subagents.ts          # Running subagents' model/effort/tokens from their own transcripts
├── daemon.ts             # Warm daemon server (opt-in; serves renders over a local socket)
├── daemon-client.ts      # Daemon client: connect-with-timeout, inline fallback, spawn lock
├── daemon-ipc.ts         # Shared IPC: per-profile socket path, NDJSON framing, version
├── types.ts              # TypeScript interfaces
└── render/
    ├── index.ts          # Main render coordinator
    ├── pills.ts          # Default pill row (ported from the usage-band mod): palettes, layout, ANSI
    ├── session-line.ts   # Compact session line
    ├── lines/            # Expanded element renderers (usage, project, …)
    ├── tools-line.ts     # Tool activity
    ├── agents-line.ts    # Agent status
    ├── todos-line.ts     # Todo progress
    └── colors.ts         # ANSI color helpers
```

### Output Format

Default (`lineLayout: "pills"`): one row of pills, in a light and a dark palette (`display.pillTheme`), reflowed to the pane width by `layout()` in `render/pills.ts`. Any UI change there must be checked in both palettes.

```
 Opus 5.5 medium │ ◔ ╸━━━━━━━ 7% 69.0k/1.0M    ◷ 5h ━━━╸━━━━ 42% │ 2:10 PM    ▦ 7d ╸━━━━━━━ 8% │ Sat 2:00 AM     my-project │  main ~6 ?3
```

`lineLayout: "compact"`:

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

**StatusLine configuration** must be added to the user's `~/.claude/settings.json` via `/claude-hud-enhanced:setup`.

The setup command adds an auto-updating command that finds the latest installed version at runtime.

Note: `statusLine` is NOT a valid plugin.json field. It must be configured in settings.json after plugin installation. Updates are automatic - no need to re-run setup.

## Dependencies

- **Runtime**: Node.js 18+ or Bun
- **Build**: TypeScript 5, ES2022 target, NodeNext modules
