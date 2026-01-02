# ADR 004: Session Handling

## Status
Accepted

## Context
Current problems with session handling:
1. HUD doesn't attach correctly when user runs `/new`
2. `/exit` and `/resume` leave HUD in stale state
3. Session ID not tracked consistently
4. No graceful handling of session switches

Users expect the HUD to "just work" regardless of how they navigate Claude Code sessions.

## Decision
**Track session ID in all events, detect changes, and reset state gracefully.**

### Session Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    Session States                            │
│                                                              │
│    ┌──────────┐                                             │
│    │  INIT    │ ─────────────────────────┐                  │
│    └────┬─────┘                          │                  │
│         │ SessionStart                   │                  │
│         ▼                                │                  │
│    ┌──────────┐     /new or /exit        │                  │
│    │  ACTIVE  │ ──────────────────►  ┌───┴───┐              │
│    └────┬─────┘                      │ RESET │              │
│         │                            └───┬───┘              │
│         │ Stop event                     │                  │
│         ▼                                │                  │
│    ┌──────────┐                          │                  │
│    │  IDLE    │ ◄────────────────────────┘                  │
│    └──────────┘                                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Session ID Tracking

Every event includes `session_id`:

```typescript
interface HudEvent {
  session_id: string;  // Always present
  hook_event_name: string;
  timestamp: number;
  // ... other fields
}
```

### Session Change Detection

```typescript
// hooks/useSession.ts
function useSession() {
  const [currentSession, setCurrentSession] = useState<string | null>(null);

  const handleEvent = useCallback((event: HudEvent) => {
    if (currentSession && event.session_id !== currentSession) {
      // SESSION CHANGED - reset all state
      resetAllState();
    }
    setCurrentSession(event.session_id);
  }, [currentSession]);

  return { currentSession, handleEvent };
}
```

### State Reset on Session Change

When session changes, reset:
- Tool history (clear)
- Agent list (clear)
- Context tracking (reset to zero)
- Cost tracking (reset)
- Todos (clear)
- Modified files (clear)

Do NOT reset:
- Git status (session-independent)
- MCP status (session-independent)
- UI preferences (if any)

### FIFO Reconnection Strategy

```typescript
// lib/event-reader.ts
class EventReader {
  private sessionId: string;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30_000; // 30 seconds max

  private getReconnectDelay(): number {
    // Exponential backoff: 100ms, 200ms, 400ms, ... up to 30s
    const delay = Math.min(
      100 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts++;
    return delay;
  }

  private async reconnect(): Promise<void> {
    const delay = this.getReconnectDelay();
    await sleep(delay);

    // Check if FIFO still exists
    if (await this.fifoExists()) {
      await this.connect();
      this.reconnectAttempts = 0; // Reset on success
    } else {
      // Session ended, clean up
      this.emit('session_ended');
    }
  }
}
```

### Handling /new, /exit, /resume

| Command | Expected Behavior |
|---------|-------------------|
| `/new` | New session starts, HUD resets and attaches to new session |
| `/exit` | Session ends, HUD shows idle/disconnected state |
| `/resume` | Resume session, HUD reconnects to existing FIFO |

### Implementation: SessionStart Hook

```bash
# session-start.sh
# Check if HUD is already running for this session
existing_pid=$(cat "$PID_FILE" 2>/dev/null)
if kill -0 "$existing_pid" 2>/dev/null; then
  # Send signal to reconnect instead of spawning new
  kill -USR1 "$existing_pid"
else
  # Spawn new HUD instance
  spawn_hud
fi
```

### UI Feedback for Session States

| State | UI Indication |
|-------|---------------|
| INIT | "Connecting..." |
| ACTIVE | Normal display |
| IDLE | "Idle" badge, dimmed metrics |
| DISCONNECTED | "Reconnecting..." with spinner |
| SESSION_CHANGED | Brief "New Session" indicator, then reset |

## Consequences

### Positive
- **Seamless transitions**: /new /exit /resume just work
- **No stale data**: Session changes trigger clean reset
- **User confidence**: HUD always shows current session state
- **Debuggable**: Session ID in all events for tracing

### Negative
- **State loss on /new**: Previous session data gone (acceptable)
- **Brief disruption**: Reset causes momentary blank UI
- **Complexity**: More state to manage

### Edge Cases

1. **Rapid /new /new /new**: Each creates new FIFO, HUD follows last one
2. **FIFO deleted externally**: Reconnect logic handles gracefully
3. **Claude Code crashes**: SessionEnd may not fire, rely on FIFO absence
4. **Multiple terminals**: Each Claude instance has its own FIFO

## Implementation Notes

1. Add `session_id` to all events in capture-event.sh
2. Create `useSession` hook for session state management
3. Emit 'session_changed' event when ID changes
4. All state hooks listen for session_changed to reset
5. Add reconnection logic to EventReader
6. Add session state indicator to StatusBar component
