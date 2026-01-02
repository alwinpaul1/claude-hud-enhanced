# ADR 001: State Management Architecture

## Status
Accepted

## Context
The current `app.tsx` is 300+ lines with complex nested callbacks and multiple state variables scattered throughout. This makes the code:
- Hard to test
- Difficult to reason about
- Prone to race conditions
- Hard to maintain

We need a state management approach that:
1. Is simple enough for a metrics dashboard (not a full application)
2. Makes state transitions predictable
3. Is easily testable
4. Prevents unnecessary re-renders

## Decision
**Use custom hooks + useReducer, NOT XState or global Context.**

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         App.tsx                              │
│  (thin orchestration layer, <100 lines)                     │
├─────────────────────────────────────────────────────────────┤
│                      Custom Hooks                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │useHudState   │ │useToolStream │ │useContextTracking    │ │
│  │(main reducer)│ │(tool history)│ │(tokens, burn rate)   │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │useAgents     │ │useTodos      │ │useGitStatus          │ │
│  │(agent list)  │ │(todo list)   │ │(branch, changes)     │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Why NOT XState?
- Overkill for a dashboard with simple state
- Learning curve for contributors
- Additional dependency
- State machine formalism doesn't fit well with streaming events

### Why NOT Context API?
- No prop drilling problem (flat component hierarchy)
- Global state not needed (components don't need to share state across deep trees)
- Adds complexity without benefit

### Why Custom Hooks + useReducer?
- **Encapsulation**: Each hook owns its domain (tools, agents, context, etc.)
- **Testability**: Hooks can be tested in isolation with `@testing-library/react-hooks`
- **Predictability**: useReducer makes state transitions explicit and debuggable
- **Performance**: Each hook manages its own re-renders
- **Simplicity**: No new dependencies, standard React patterns

### Example Structure

```typescript
// hooks/useToolStream.ts
type ToolAction =
  | { type: 'TOOL_START'; payload: ToolEntry }
  | { type: 'TOOL_END'; payload: { id: string; duration: number } }
  | { type: 'CLEAR' };

function toolReducer(state: ToolEntry[], action: ToolAction): ToolEntry[] {
  switch (action.type) {
    case 'TOOL_START':
      return [action.payload, ...state].slice(0, 30);
    case 'TOOL_END':
      return state.map(t =>
        t.id === action.payload.id
          ? { ...t, status: 'done', duration: action.payload.duration }
          : t
      );
    case 'CLEAR':
      return [];
  }
}

export function useToolStream() {
  const [tools, dispatch] = useReducer(toolReducer, []);

  const startTool = useCallback((tool: ToolEntry) => {
    dispatch({ type: 'TOOL_START', payload: tool });
  }, []);

  const endTool = useCallback((id: string, duration: number) => {
    dispatch({ type: 'TOOL_END', payload: { id, duration } });
  }, []);

  return { tools, startTool, endTool };
}
```

## Consequences

### Positive
- Clear separation of concerns
- Easy to test each hook independently
- Standard React patterns (no learning curve)
- Explicit state transitions via reducer actions
- Each domain isolated (tools don't know about agents)

### Negative
- More files to manage (one per hook)
- Need to coordinate between hooks in App.tsx
- No automatic state persistence (acceptable for session-scoped data)

## Implementation Notes

1. Create `tui/src/hooks/` directory
2. Extract state logic from app.tsx into domain hooks
3. App.tsx becomes thin orchestration layer
4. Each hook is independently testable
