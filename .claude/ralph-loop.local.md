---
active: true
iteration: 1
max_iterations: 100
completion_promise: "HUD V2 COMPLETE"
started_at: "2026-01-02T03:08:24Z"
---

You are iteratively improving claude-hud v2, a Claude Code plugin that shows a real-time terminal HUD.

## GOAL
Make this THE definitive Claude Code developer dashboard. Surface everything developers need: real tokens, costs, model info, conversation flow, compaction events. Vercel-grade polish.

## CURRENT STATE
- v1.0.0 complete with: context meter, tool stream, agent tracking, session stats
- React/Ink TUI
- Hooks: PostToolUse, SubagentStop, SessionStart, SessionEnd

## PHASE 1: Enhanced Data Capture
Add missing hooks to hooks.json:
- PreToolUse (true running state)
- UserPromptSubmit (track prompts)
- Stop (idle detection)
- PreCompact (compaction events)

Enrich capture-event.sh with:
- permission_mode, transcript_path, cwd

Research real token counting from transcript_path JSONL.

Push after phase.

## PHASE 2: UI Enhancements
- Token sparkline (▁▂▃▄▅▆▇█ characters)
- Cost estimation panel ($ based on Anthropic pricing)
- Session status bar (model, permission mode, idle/working, compaction count)
- Conversation preview (last user prompt)
- Visual polish

Push after phase.

## PHASE 3: Developer Experience
- Post-install verification
- Screenshot for README
- Troubleshooting guide
- Configuration support (.claude-hud.json)

Push after phase.

## PHASE 4: Robustness & Testing
- Test all new components
- Test edge cases
- Profile performance

Push after phase.

## PHASE 5: Documentation Excellence
- README rewrite with screenshot
- Enhanced CONTRIBUTING
- Code documentation

Push after phase.

## PHASE 6: Advanced Features
- MCP server health indicators
- Git integration (branch, changes)
- Keyboard shortcuts
- Theme support

Push after phase.

## PHASE 7: Final Polish
- Version 2.0.0
- Performance audit
- Code cleanup
- Changelog

Push after phase.

## RULES
1. Commit after meaningful improvements
2. Push after each PHASE
3. Run tests frequently
4. If stuck 3+ times, TODO comment and move on
5. Keep HUD performant
6. Installation: claude /plugin install github.com/jarrodwatts/claude-hud

## COMPLETION
Output <promise>HUD V2 COMPLETE</promise> ONLY when:
- All new hooks capturing data
- Token sparkline working
- Cost estimation visible
- Session status bar with model/mode
- Screenshot in README
- Troubleshooting guide
- Tests cover new features
- Version 2.0.0
- Performance verified

After 90 iterations, output promise anyway with summary.
