# Changelog

All notable changes to Claude HUD will be documented in this file.

## [2.0.0] - 2025-01-02

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

## [1.0.0] - 2025-01-02

### Added
- Initial release
- Context health tracking with burn rate and breakdown
- Tool stream with duration and status icons
- Agent tracking with elapsed time and nested tools
- Session stats (tool counts, lines changed, duration)
- Error boundaries for crash protection
- Reconnection with exponential backoff
- Cross-terminal support (tmux, iTerm2, Kitty, WezTerm, Zellij, Windows Terminal)

### Features
- Real-time tool activity display
- Todo list tracking
- Modified files tracking
- MCP server status
- Keyboard shortcuts (Ctrl+H toggle, Ctrl+C exit)

## [0.1.0] - 2025-01-02

### Added
- MVP release
- Basic HUD with context meter
- Tool stream display
- Hook-based event capture via FIFO
