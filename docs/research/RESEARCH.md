# Claude HUD Research Findings

This document captures research conducted to inform the architecture and implementation of claude-hud v2.

## 1. Claude Code Plugin Best Practices

### Sources
- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Claude Code Plugins Announcement](https://www.anthropic.com/news/claude-code-plugins)
- [GitHub: claude-code/plugins](https://github.com/anthropics/claude-code/blob/main/plugins/README.md)

### Key Principles

1. **Low-level and Unopinionated**: Claude Code provides close to raw model access without forcing specific workflows. This design philosophy creates a flexible, customizable, scriptable, and safe power tool.

2. **Plugin Components**:
   - **Hooks**: Customize behavior at key points (PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, etc.)
   - **Commands**: Slash commands defined in markdown files
   - **Skills**: Knowledge and workflows bundled together
   - **Subagents**: Purpose-built agents for specialized tasks
   - **MCP Servers**: Connect to tools and data sources

3. **Hook Architecture**:
   - Hooks execute shell scripts in response to lifecycle events
   - Input is provided via environment variables and stdin (JSON)
   - Output is captured from stdout
   - Non-blocking writes to FIFOs are critical for performance

4. **Best Practices**:
   - Use CLAUDE.md for project-specific guidance
   - Commands can use `$ARGUMENTS` for parameterization
   - MCP servers can be project-scoped, global, or checked in
   - Debug with `--mcp-debug` flag

### Implications for claude-hud

- **Event-driven over polling**: Hooks provide real-time events; polling should be minimized
- **Non-blocking I/O**: Critical for not slowing down Claude Code
- **Session lifecycle awareness**: Need to handle SessionStart, SessionEnd, and session switching gracefully

---

## 2. TUI Design Principles (lazygit, btop, etc.)

### Sources
- [lazygit GitHub](https://github.com/jesseduffield/lazygit)
- [awesome-tuis](https://github.com/rothgar/awesome-tuis)
- [The (lazy) Git UI You Didn't Know You Need](https://www.bwplotka.dev/2025/lazygit/)

### What Makes Great TUIs

1. **Visual Organization & Consistency**
   - Set of boxes ("views") with consistent behavior
   - Most views visible at all times (unless zoomed)
   - Strong visual hierarchy

2. **Core UX Principles**
   - Simplicity
   - Consistency
   - Discoverability
   - Sane defaults
   - Shortcuts for common flows
   - Interactivity

3. **Enhanced Visualization**
   - Present complex information in structured, readable ways
   - Use graphs and charts for time-series data
   - Make patterns visible at a glance

4. **Keyboard-Driven Navigation**
   - Vim-style keybindings (h/j/k/l, q to quit)
   - Consistent across the application
   - / for filtering, y for copy

5. **Reduced Context Switching**
   - All relevant information in one view
   - No need to switch to other terminals/tools

6. **Learning Curve & Discoverability**
   - Stick to familiar terms and abstractions
   - Guide users through complex operations
   - Make advanced features discoverable

### Implications for claude-hud

- **Single canonical layout**: Don't overcomplicate with modes
- **Information density**: Show what matters most prominently
- **Consistency**: Same patterns throughout the UI
- **Glanceable**: Key metrics visible at a glance
- **No interactivity needed**: View-only is fine for a metrics dashboard

---

## 3. Ink/React Terminal UI Patterns

### Sources
- [Ink GitHub](https://github.com/vadimdemedes/ink)
- [Ink 3 Release Notes](https://vadimdemedes.com/posts/ink-3)
- [Building CLI tools with React using Ink](https://medium.com/trabe/building-cli-tools-with-react-using-ink-and-pastel-2e5b0d3e2793)

### Key Features & Patterns

1. **Core Components**
   - `<Text>`: Fundamental text rendering with colors, styling
   - `<Box>`: Flexbox-based layout container
   - `<Static>`: Renders content once, never updates (CRITICAL for performance)
   - `<Transform>`: Output transformation utility

2. **Performance Optimization**

   **Frame Rate Control**:
   ```tsx
   <App> // Configure max FPS to reduce CPU usage
   ```

   **`<Static>` Component** (CRITICAL):
   - Renders items permanently above the UI
   - Cannot update after display
   - Perfect for logs, completed items
   - Almost 2x more performant in Ink 3
   - Used by Jest, Tap, Gatsby for large outputs

   **Incremental Rendering**:
   - Only updates changed lines
   - Reduces flickering
   - Better for frequently updating UIs

3. **Focus Management**
   - `useFocus` hook for component focus
   - `useFocusManager` for complex navigation
   - Tab to cycle through focusable components

4. **Console Logging**
   - Ink intercepts console.log/error
   - Displays correctly above the UI
   - Prevents interference with rendering

### Critical Performance Insight

The `<Static>` component is key for preventing flickering:
- Use for persistent headers, completed items
- Only dynamic content should re-render
- Separating static from dynamic prevents full redraws

### Implications for claude-hud

- **Use `<Static>` strategically**: Headers, section dividers should not re-render
- **Minimize re-renders**: Only update components that actually changed
- **Memoization**: Use React.memo, useMemo, useCallback
- **Debounce rapid updates**: Context updates shouldn't cause rapid re-renders
- **Single source of truth**: Avoid multiple polling sources causing conflicting updates

---

## 4. Current Architecture Problems

Based on analysis of the existing codebase:

### Data Flow Issues
1. **Multiple polling sources** (30s each): settings, context, transcript
2. **Race conditions**: FIFO cleanup timing issues
3. **Silent error handling**: Errors swallowed, hard to debug
4. **State inconsistency**: Multiple sources can cause flickering

### Code Quality Issues
1. **app.tsx is 300+ lines**: Too much in one file
2. **Type assertions**: Using `as` instead of proper discriminated unions
3. **No linting/formatting**: Inconsistent code style
4. **Missing tests**: Several components untested

### Session Handling Issues
1. **Session attachment fails**: /new /exit /resume don't work smoothly
2. **No cleanup on session switch**: Stale data persists

---

## 5. Architecture Recommendations

Based on research, here are the recommended approaches:

### State Management
**Recommendation: Custom hooks + useReducer**
- Not XState (overkill for this use case)
- Not Context API alone (prop drilling isn't an issue)
- Custom hooks encapsulate related state logic
- useReducer for complex state transitions

### Data Flow
**Recommendation: Event-driven with minimal polling**
- Primary: Hook events via FIFO (real-time)
- Secondary: Single consolidated poll for data not in events
- Eliminate redundant polling sources

### Shell Scripts
**Recommendation: Keep bash for hooks, move logic to TypeScript**
- Hooks MUST be shell scripts (Claude Code requirement)
- But keep them minimal - just pass data to FIFO
- Complex logic in TypeScript (testable)

### Session Handling
**Recommendation: Session ID in events + graceful reconnection**
- Track session ID in all events
- Detect session changes and reset state
- Reconnect FIFO with exponential backoff

---

## 6. Action Items from Research

1. **Refactor to event-driven architecture**: Single FIFO, minimal polling
2. **Use `<Static>` for stable UI sections**: Prevent unnecessary re-renders
3. **Extract state to custom hooks**: useContextState, useToolStream, etc.
4. **Add proper error handling**: No silent catches, structured logging
5. **Implement session tracking**: Detect /new /exit /resume
6. **Add ESLint + Prettier**: Consistent code quality
7. **Comprehensive tests**: Especially for state transitions

---

## References

- [Anthropic: Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [Claude Code Plugins](https://www.anthropic.com/news/claude-code-plugins)
- [Ink GitHub](https://github.com/vadimdemedes/ink)
- [lazygit](https://github.com/jesseduffield/lazygit)
- [awesome-tuis](https://github.com/rothgar/awesome-tuis)
