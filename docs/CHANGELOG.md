# Changelog

All notable changes to claude-hud will be documented in this file.

## [2.0.1] - 2026-01-03

### Added
- **Debug logging**: Proper error logging via `CLAUDE_HUD_DEBUG=1`
  - Logger utility with debug/warn/error levels
  - Replaces all silent catch blocks with logged errors
- **GitHub Actions CI**: Automated lint, typecheck, test, and build on push/PR
  - Plugin structure validation (plugin.json, hooks.json, scripts)
  - Note: Requires `workflow` scope on GitHub token to push

### Fixed
- **Agent tools tracking**: Agent tools array now populates correctly
  - Tools tracked per-agent and limited to last 5 calls
  - Excludes Task tool itself from tracking

### Improved
- **Test coverage**: Increased from 82% to 90%+ (31 new tests)
  - Added tests for logger, ContextInfo, useElapsedTime, StatsReader
- **Performance**: Added React.memo to prevent unnecessary re-renders
  - Wrapped ContextMeter, ToolStream, CostDisplay
  - Moved helper functions outside component bodies

### Removed
- Unused components: Edits.tsx, RateLimitMeter.tsx
- Unused types: AppState interface
- Unused exports: readStats() now internal-only

---

## [2.0.0] - 2026-01-02

### Architecture Overhaul

A complete rewrite focusing on stability, accuracy, and developer experience.

### Added
- **UnifiedContextTracker**: Single source of truth for context tracking
  - Reads real token counts from Claude transcript files
  - Falls back to estimation when transcript unavailable
  - Eliminates flickering from dual data sources
- **CostDisplay**: Real-time API cost estimation
  - Tracks input/output tokens separately
  - Automatic model detection for accurate pricing
  - Supports Opus, Sonnet, and Haiku pricing
- **Custom hooks architecture**:
  - `useHudState` - Centralized state management
  - `useElapsedTime` - Session timer hook
- **Code quality tooling**:
  - ESLint with TypeScript, React, and React Hooks rules
  - Prettier with consistent formatting
  - Husky pre-commit hooks with lint-staged
- **Comprehensive test suite**: 152 tests covering all components

### Changed
- **app.tsx**: Reduced from 329 lines to 136 lines (59% reduction)
- **Context tracking**: Reads transcript on Stop events only, not polling
- **State management**: Follows ADR 001 pattern with custom hooks

### Fixed
- **Context flickering**: Eliminated dual-source updates
- **Session handling**: Proper transcript path detection on /resume
- **Test reliability**: Fixed race condition in smoke tests

### Technical
- Added Architecture Decision Records (ADRs):
  - ADR 001: State management via custom hooks
  - ADR 002: Event-driven data flow with minimal polling
  - ADR 003: Minimal shell scripts, logic in TypeScript
  - ADR 004: Session ID tracking for graceful transitions
- Research documented in `docs/research/RESEARCH.md`

## [1.0.0] - Initial Release

- Context meter with sparkline
- Tool stream with live status
- Agent tracking
- Todo list display
- Session statistics
- Git status panel
- MCP server status
