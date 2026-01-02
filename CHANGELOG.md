# Changelog

All notable changes to Claude HUD will be documented in this file.

## [0.1.0] - 2025-01-02

### Added
- **Developer Intelligence Dashboard**: Surface real data from Claude Code internals
- **Real Token Stats**: Read actual token usage from `~/.claude/stats-cache.json` instead of estimates
- **Model Display**: Show current model (opus/sonnet/haiku) from settings
- **Plugin & MCP Awareness**: Display enabled plugins and MCP server counts from `~/.claude/settings.json`
- **CLAUDE.md Detection**: Show when global and project CLAUDE.md files are loaded
- **StatusBar Component**: Rich header showing model, idle state, plugin/MCP counts, and working directory
- **ContextInfo Component**: Visual indicator of loaded context files

### Changed
- ContextMeter now displays real token data when available (today's usage, cache stats)
- McpStatus renamed to Connections, now shows both MCP servers and plugins

### Technical
- Added settings-reader.ts for parsing ~/.claude/settings.json
- Added stats-reader.ts for parsing ~/.claude/stats-cache.json
- Added context-detector.ts for CLAUDE.md file detection
- 30-second polling interval for settings/stats refresh

---

## [0.0.2] - 2025-01-02

### Added
- **Enhanced Hook Support**: Added PreToolUse, UserPromptSubmit, Stop, and PreCompact hooks
- **Cost Estimation**: Real-time cost tracking with input/output breakdown (supports Sonnet/Opus/Haiku pricing)
- **Token Sparkline**: Visual history of token usage over time
- **Session Status**: Idle indicator (💤/⚡), permission mode display, compaction count
- **Git Integration**: Branch name, ahead/behind counts, staged/modified/untracked file counts
- **Last Prompt Preview**: Shows last user prompt submitted
- **Verification Script**: `verify-install.sh` to check installation status
- **Comprehensive Tests**: 90+ tests covering components, event parsing, cost tracking

### Improved
- Tool stream now shows true "running" state via PreToolUse hook
- Better event handling with toolUseId correlation
- Enhanced documentation with architecture overview
- Comprehensive troubleshooting guide

### Technical
- Added ink-testing-library for component testing
- CostTracker class for API cost estimation
- GitStatus component with 30-second auto-refresh
- Event parser with edge case handling
