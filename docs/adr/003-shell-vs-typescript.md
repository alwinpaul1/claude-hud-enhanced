# ADR 003: Shell Scripts vs TypeScript

## Status
Accepted

## Context
Current implementation uses shell scripts for:
1. `session-start.sh` - Spawns HUD, creates FIFO, manages split pane
2. `capture-event.sh` - Processes hook events, writes to FIFO
3. `cleanup.sh` - Kills process, removes FIFO
4. `verify-install.sh` - Checks installation

Questions:
- Should we keep shell scripts or rewrite in TypeScript/Node?
- What logic belongs where?

## Decision
**Keep shell scripts for hooks (required), but make them minimal. Move logic to TypeScript.**

### Why Shell Scripts Are Required for Hooks

Claude Code hooks **must** be shell scripts. From the plugin spec:
- `command` field specifies the shell command to run
- Environment variables passed to the script
- JSON input via stdin, output via stdout

There is no option to use Node.js directly for hooks.

### The Minimal Shell Script Pattern

Shell scripts should do exactly two things:
1. Parse/extract essential data from hook input
2. Write to FIFO or perform one simple action

```bash
#!/bin/bash
# capture-event.sh - MINIMAL

set -uo pipefail

# Extract just what we need
event_name="$HOOK_EVENT_NAME"
session_id="$SESSION_ID"
timestamp=$(date +%s)

# Read stdin (JSON from Claude Code)
input=$(cat)

# Write to FIFO (non-blocking)
if [[ -p "$FIFO_PATH" ]]; then
  echo "{\"event\":\"$event_name\",\"session\":\"$session_id\",\"ts\":$timestamp,\"data\":$input}" > "$FIFO_PATH" &
fi
```

### What Moves to TypeScript

| Currently in Shell | Move to TypeScript? | Reason |
|-------------------|---------------------|--------|
| FIFO creation | Yes | Better error handling, cross-platform |
| Split pane creation | Keep in shell | AppleScript/osascript required |
| Event processing | Yes | Complex logic should be testable |
| JSON parsing | Minimal in shell | jq for extraction, full parsing in TS |
| Process management | Keep in shell | PID files, signals are shell-native |
| Data enrichment | Yes | TypeScript has better tooling |

### New Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Shell Scripts (Hooks)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ capture-event.sh - Extract data, write raw to FIFO   │  │
│  │ session-start.sh - Create FIFO, spawn HUD process    │  │
│  │ cleanup.sh - Signal process, remove FIFO             │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    TypeScript (TUI)                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ EventReader - Read FIFO, parse JSON, validate        │  │
│  │ EventProcessor - Enrich events, compute derived data │  │
│  │ State Hooks - Update UI state from processed events  │  │
│  │ Components - Render UI                               │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### TypeScript Event Processing

```typescript
// lib/event-processor.ts
interface RawEvent {
  event: string;
  session: string;
  ts: number;
  data: unknown;
}

interface ProcessedEvent {
  type: 'tool_start' | 'tool_end' | 'agent_stop' | 'session_change' | ...;
  timestamp: Date;
  sessionId: string;
  payload: ToolEvent | AgentEvent | SessionEvent | ...;
}

function processEvent(raw: RawEvent): ProcessedEvent {
  // Validation, type narrowing, enrichment
  // All testable in TypeScript
}
```

## Consequences

### Positive
- **Testability**: TypeScript logic is fully unit testable
- **Type safety**: Catch errors at compile time
- **Maintainability**: Complex logic in familiar language
- **Cross-platform**: TypeScript works everywhere Node runs
- **Debugging**: Better stack traces, source maps

### Negative
- **Two languages**: Shell for hooks, TypeScript for logic
- **Coordination**: Shell must output format TypeScript expects
- **Still need shell knowledge**: Hooks can't be avoided

### Shell Script Guidelines

1. **No complex logic** - If you need `if/then/else` more than once, reconsider
2. **No error recovery** - Let it fail fast, TypeScript handles gracefully
3. **Non-blocking writes** - Always use `&` for FIFO writes
4. **Timeouts for commands** - Use `timeout 1s command` for any external call
5. **Minimal dependencies** - Only rely on POSIX + jq

## Implementation Notes

1. Simplify capture-event.sh to raw data extraction only
2. Create `lib/event-processor.ts` for event enrichment
3. Add comprehensive tests for event processing
4. Keep session-start.sh for platform-specific terminal handling
