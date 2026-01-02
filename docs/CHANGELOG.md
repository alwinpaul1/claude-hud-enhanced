# Changelog

All notable changes to claude-hud will be documented in this file.

## [Unreleased] - v2.0.0 Architecture Overhaul

### Research Phase
- Researched Claude Code plugin best practices from Anthropic documentation
- Studied TUI design principles from lazygit, btop, and awesome-tuis
- Analyzed Ink/React terminal UI performance patterns
- Documented findings in `docs/research/RESEARCH.md`

### Architecture Decisions
- **ADR 001**: State management via custom hooks + useReducer (not XState/Context)
- **ADR 002**: Event-driven data flow with minimal polling
- **ADR 003**: Minimal shell scripts, logic in TypeScript
- **ADR 004**: Session ID tracking for graceful /new /exit /resume handling

### Key Changes Planned
- Refactor 300+ line app.tsx into domain-specific hooks
- Eliminate multiple polling sources that cause flickering
- Add proper session change detection
- Implement exponential backoff reconnection
- Add ESLint + Prettier for code quality
- Set up GitHub Actions CI

### What Users Will Notice
- **No more flickering**: Single event source instead of multiple pollers
- **Session handling works**: /new, /exit, /resume transitions smoothly
- **Accurate context**: Real token counts from events, not estimates
- **Better performance**: Reduced CPU usage from eliminated polling
