---
active: true
iteration: 1
max_iterations: 100
completion_promise: "LAUNCH READY"
started_at: "2026-01-02T02:25:58Z"
---

You are iteratively improving claude-hud, a Claude Code plugin that shows a real-time terminal HUD in a split pane.

## GOAL
Make this a Vercel-grade developer experience ready for a viral Twitter launch. Zero config magic where everything just works. Install the plugin, start Claude Code, and the HUD appears with useful real-time information.

## CURRENT STATE
- MVP: basic HUD with context meter, tool stream, MCP status, todos, modified files, agents
- React/Ink TUI in tui/
- Hook-based event capture via FIFO
- Supports tmux, iTerm2, Kitty, WezTerm, Zellij, Windows Terminal

## DESIGN PRINCIPLES
1. Peripheral awareness - always visible like a car dashboard
2. Context is the killer feature - help developers understand context health
3. Pure display - read-only, no interaction needed
4. Subtle alerts - color changes for warnings, never intrusive
5. Zero config - works perfectly out of the box

## PHASE 1: Context Health (THE KILLER FEATURE)
Context is the most important thing when working with AI. Make this exceptional.

Research:
- How can we get accurate token counts? Check if Claude Code exposes this anywhere
- Research context engineering best practices and blogs
- What makes context 'healthy' vs 'unhealthy'?

Implement:
- Accurate token tracking (investigate Claude Code internals, or best approximation)
- Burn rate indicator (tokens/minute trend)
- Compaction warning when approaching threshold
- Context breakdown - show what's consuming context (tool outputs, messages, etc)
- Consider a 'Context Score' or health indicator

Push after this phase completes.

## PHASE 2: Tool Stream Enhancement
- Show: Tool + status + duration (e.g., 'Grep: auth/ (1.2s) ✓')
- Color-code: green=success, red=error, yellow=running
- Smart truncation for long paths (filename + parent)
- For nested agent tools, show latest 2-3 only

Push after this phase completes.

## PHASE 3: Agent Tracking
- Show type + description ('Explore: finding auth patterns')
- Elapsed time for running agents
- Nested activity - agent's own tool calls as sub-items
- Completion status

Push after this phase completes.

## PHASE 4: Session Stats & Polish
Add session-wide statistics:
- Tool counts by type (23 Reads, 15 Edits, 8 Bash...)
- Lines changed (+342 / -89 across N files)
- Session duration
- Agent spawn counts

Visual polish:
- Subtle animations/transitions for status changes
- Make it visually distinctive and memorable
- Ensure 45-55 char width works well

Push after this phase completes.

## PHASE 5: Session Lifecycle & Robustness
- Handle Claude Code lifecycle: fresh start, --continue, --resume
- Reconnect to existing session on resume
- Show 'disconnected' state cleanly
- Error boundaries for React components
- Graceful degradation when FIFO unavailable
- Handle edge cases (empty data, rapid events, very long paths)

Push after this phase completes.

## PHASE 6: Cross-Terminal Support
- Verify native splits work: tmux, iTerm2, Kitty, WezTerm, Zellij
- Implement fallback to separate window for unsupported terminals
- Test on macOS Terminal
- Ensure reliable behavior everywhere

Push after this phase completes.

## PHASE 7: Testing
- Add vitest for unit tests
- Test EventReader (parsing, reconnection, malformed JSON)
- Test key components
- Test hook scripts

Push after this phase completes.

## PHASE 8: Documentation & Onboarding
README must be excellent:
- Clear installation: claude /plugin install github.com/jarrod/claude-hud
- GIF or screenshot showing HUD in action
- Feature overview
- Supported terminals list
- Zero config emphasis

Add CONTRIBUTING.md for contributors.
Clean up package.json metadata.

Push after this phase completes.

## PHASE 9: Final Polish
- TypeScript strict mode with no errors
- Remove console.log statements
- Clean, meaningful commit messages
- Version bump to 1.0.0
- Final README review

Push after this phase completes.

## RULES
1. Commit after each meaningful improvement with descriptive message
2. Push after each PHASE completes (not individual commits)
3. Run tests after significant changes
4. If stuck on something for 3+ attempts, document the issue in a TODO comment and move on
5. Keep the HUD performant - no heavy operations in render loop
6. Installation MUST remain: claude /plugin install github.com/jarrod/claude-hud

## COMPLETION CRITERIA
Output <promise>LAUNCH READY</promise> ONLY when:
- Context health feature is working and useful
- Tool stream shows real-time activity with status/duration
- Agent tracking with nested activity works
- Session stats are visible
- Cross-terminal support verified
- Tests passing
- README is polished and complete
- TypeScript compiles clean
- The plugin feels delightful to use

If after 90 iterations you haven't completed everything, output <promise>LAUNCH READY</promise> anyway with a summary of what's done vs what remains.
