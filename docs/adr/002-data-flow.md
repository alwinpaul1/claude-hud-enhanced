# ADR 002: Data Flow Architecture

## Status
Accepted

## Context
The current implementation has multiple data sources:
1. FIFO events from hooks (PreToolUse, PostToolUse, etc.)
2. Polling settings reader (30s interval)
3. Polling context detector (30s interval)
4. Polling transcript reader (30s interval)

This causes:
- **Flickering**: Multiple sources updating at different times
- **Race conditions**: Stale data overwriting fresh data
- **Inconsistency**: Different sources have different views of state
- **Performance overhead**: 3 timers running constantly

## Decision
**Event-driven primary, consolidated polling secondary.**

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code                               │
│                         │                                    │
│                    Hook Events                               │
│                         ▼                                    │
├─────────────────────────────────────────────────────────────┤
│                 capture-event.sh                             │
│         (minimal: extract data, write to FIFO)              │
│                         │                                    │
│                         ▼                                    │
├─────────────────────────────────────────────────────────────┤
│                      FIFO                                    │
│              ~/.claude/hud/events/<session>.fifo            │
│                         │                                    │
│                         ▼                                    │
├─────────────────────────────────────────────────────────────┤
│                   EventReader                                │
│     (single source of truth, auto-reconnect)                │
│                         │                                    │
│           ┌─────────────┼─────────────┐                     │
│           ▼             ▼             ▼                     │
│    useToolStream  useContextState  useAgents                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Event Types (Primary Data Source)

| Hook Event | Data Provided |
|------------|---------------|
| SessionStart | session_id, cwd, model |
| PreToolUse | tool_name, input (starting) |
| PostToolUse | tool_name, output, duration, tokens |
| Stop | idle state |
| SubagentStop | agent completion |
| PreCompact | compaction warning |
| UserPromptSubmit | user prompt |

### Consolidated Polling (Secondary, Single Timer)

One 60-second poll for data NOT available in events:
- Git status (branch, staged, modified)
- MCP server status (connected servers)

```typescript
// Single consolidated poll
useEffect(() => {
  const poll = async () => {
    const [git, mcp] = await Promise.all([
      getGitStatus(),
      getMcpStatus()
    ]);
    setGitStatus(git);
    setMcpStatus(mcp);
  };

  poll();
  const interval = setInterval(poll, 60_000);
  return () => clearInterval(interval);
}, []);
```

### What Gets Removed

1. **settings-reader.ts polling** → Settings read once on startup
2. **context-detector.ts polling** → Context from PostToolUse events
3. **transcript-reader.ts polling** → Token data from PostToolUse events

### Token/Context Data Source

Previously: Polling transcript file
Now: Extract from PostToolUse event response

```typescript
// In capture-event.sh, extract from PostToolUse
if [[ "$HOOK_EVENT_NAME" == "PostToolUse" ]]; then
  # Extract token usage from the response
  tokens=$(echo "$response" | jq -r '.usage // empty')
fi
```

## Consequences

### Positive
- **Single source of truth**: One event stream, not multiple pollers
- **No flickering**: Updates come from one place
- **Real-time**: Hook events are immediate
- **Less CPU**: One timer instead of three
- **Predictable**: State changes trace back to discrete events

### Negative
- **Dependency on hooks**: If hooks don't fire, no data
- **Some data requires polling**: Git status not in events
- **Event ordering**: Must handle out-of-order events gracefully

### Migration Path

1. Enrich capture-event.sh to include all needed data
2. Remove separate polling utilities
3. Add single consolidated poll for git/mcp
4. Update hooks to process enriched events

## Implementation Notes

- capture-event.sh must be non-blocking (use `timeout` for commands)
- EventReader handles reconnection transparently
- State hooks receive typed events, not raw JSON
