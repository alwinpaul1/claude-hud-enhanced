# Contributing to Claude HUD

Thanks for your interest in contributing! This guide will help you get started.

## Community Standards

Please read `CODE_OF_CONDUCT.md`. For security issues, see `SECURITY.md`.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud

# Install TUI dependencies
cd tui
bun install

# Build
bun run build

# Run tests
bun test

# Run with coverage
bun test --coverage

# Lint and typecheck
bun run lint
bun run typecheck

# Format code
bun run format

# Replay a fixture event stream
bun run replay:events -- --input ../tui/test-fixtures/hud-events.jsonl

# Profile event throughput
bun run profile:events -- ../tui/test-fixtures/hud-events-stress.jsonl
```

### One-shot checks

From the repo root:

```bash
./scripts/check.sh
```

### Local Testing

To test the plugin locally without publishing:

```bash
# Create a symlink to your plugins directory
ln -sf $(pwd)/.. ~/.claude/plugins/claude-hud

# Verify installation
./scripts/verify-install.sh

# Start Claude with the plugin
claude --plugin-dir /path/to/claude-hud
```

## Project Structure

```
claude-hud/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest (name, version, hooks path)
├── hooks/
│   └── hooks.json            # Hook event subscriptions
├── scripts/
│   ├── session-start.sh      # Spawns HUD in split pane
│   ├── capture-event.sh      # Captures events and sends to FIFO
│   ├── cleanup.sh            # Cleans up on session end
│   └── verify-install.sh     # Installation verification
├── docs/
│   ├── CHANGELOG.md          # Version history
│   ├── research/             # Research notes
│   └── adr/                  # Architecture Decision Records
├── tui/
│   ├── src/
│   │   ├── index.tsx         # Entry point, session handling
│   │   ├── app.tsx           # Main App component (slim)
│   │   ├── components/       # React/Ink UI components
│   │   │   ├── ContextMeter.tsx   # Token usage + sparkline
│   │   │   ├── CostDisplay.tsx    # API cost tracking
│   │   │   ├── ToolStream.tsx     # Tool activity list
│   │   │   ├── AgentList.tsx      # Subagent tracking
│   │   │   ├── StatusBar.tsx      # Model + idle status
│   │   │   ├── SessionStats.tsx   # Session statistics
│   │   │   ├── TodoList.tsx       # Task tracking
│   │   │   ├── ContextInfo.tsx    # CLAUDE.md detection
│   │   │   ├── Sparkline.tsx      # Sparkline visualization
│   │   │   └── ErrorBoundary.tsx  # Error handling
│   │   ├── hooks/
│   │   │   ├── useHudState.ts     # Centralized state management
│   │   │   └── useElapsedTime.ts  # Timer hook
│   │   └── lib/
│   │       ├── types.ts                    # TypeScript interfaces
│   │       ├── event-reader.ts             # FIFO reader
│   │       ├── unified-context-tracker.ts  # Token tracking (real + estimated)
│   │       ├── cost-tracker.ts             # Cost estimation
│   │       ├── settings-reader.ts          # Claude settings
│   │       ├── context-detector.ts         # CLAUDE.md detection
│   │       └── logger.ts                   # Debug logging
│   ├── package.json
│   ├── tsconfig.json
│   ├── eslint.config.js      # ESLint flat config
│   └── vitest.config.ts
├── README.md
├── CONTRIBUTING.md
├── TROUBLESHOOTING.md
└── LICENSE
```

## Architecture

### Data Flow

```
Claude Code → Hook Events → capture-event.sh → FIFO → EventReader → React State → UI
```

1. Claude Code emits hook events (PreToolUse, PostToolUse, etc.)
2. `capture-event.sh` receives events and formats them as JSON
3. Events are written to a named pipe (FIFO)
4. `EventReader` reads the FIFO and emits events
5. React components update based on state changes

### Key Components

**useHudState** (`hooks/useHudState.ts`)
- Centralized state management hook
- Processes all events from EventReader
- Manages tools, agents, context, cost, todos
- Single source of truth for HUD state

**EventReader** (`lib/event-reader.ts`)
- Reads from named pipe (FIFO)
- Handles reconnection with exponential backoff
- Emits 'event' and 'status' events

**UnifiedContextTracker** (`lib/unified-context-tracker.ts`)
- Reads real tokens from transcript files when available
- Falls back to estimation when transcript unavailable
- Tracks burn rate and token history for sparkline
- Eliminates flickering from dual data sources

**CostTracker** (`lib/cost-tracker.ts`)
- Calculates cost based on token usage
- Supports different model pricing (Opus, Sonnet, Haiku)
- Tracks input/output tokens separately

## Adding a New Panel

1. Create a component in `tui/src/components/`:

```tsx
import React, { memo } from 'react';
import { Box, Text } from 'ink';

interface Props {
  data: YourDataType;
}

export const YourPanel = memo(function YourPanel({ data }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">Your Panel</Text>
      </Box>
      {/* Panel content */}
    </Box>
  );
});
```

2. Add state in `hooks/useHudState.ts`:

```tsx
const [yourData, setYourData] = useState<YourDataType>(initialValue);
```

3. Process relevant events in the `processEvent` callback:

```tsx
if (event.event === 'RelevantEvent') {
  setYourData(/* updated data */);
}
```

4. Return the new state from `useHudState`:

```tsx
return {
  // ... existing state
  yourData,
};
```

5. Add the component to `app.tsx` (wrapped in ErrorBoundary):

```tsx
<ErrorBoundary>
  <YourPanel data={state.yourData} />
</ErrorBoundary>
```

6. Add tests in `components/YourPanel.test.tsx`.

## Adding a New Hook

1. Add the hook to `hooks/hooks.json`:

```json
"NewHookEvent": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/capture-event.sh",
        "timeout": 5
      }
    ]
  }
]
```

2. Update `HudEvent` type in `types.ts` if new fields are needed.

3. Handle the event in `processEvent` in `index.tsx`.

## Running Tests

```bash
cd tui

# Run all tests
bun test

# Run tests in watch mode
bun test:watch

# Run specific test file
bun test context-tracker
```

## Code Style

- **TypeScript strict mode** - No implicit any
- **React functional components** - Use hooks, not classes
- **No `any` types** - Use `unknown` or proper types
- **Ink components** - Use Box, Text from ink for UI
- **Error boundaries** - Wrap components to prevent crashes
- **React.memo** - Use for all components to prevent unnecessary re-renders
- **ESLint + Prettier** - Run `bun run lint` and `bun run format`
- **Pre-commit hooks** - Husky runs lint-staged on commit

### Quality Tools

```bash
# Lint (ESLint)
bun run lint
bun run lint:fix

# Format (Prettier)
bun run format
bun run format:check

# Type check
bun run typecheck

# All tests with coverage
bun test --coverage
```

## Pull Requests

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Add tests for new functionality
5. Run tests: `bun test`
6. Build: `bun run build`
7. Commit with descriptive message
8. Submit PR

### PR Checklist

- [ ] Tests added/updated
- [ ] TypeScript compiles without errors
- [ ] No console.log statements in production code
- [ ] Documentation updated if needed
- [ ] Tested locally with Claude Code

## Areas for Contribution

### Features
- Real token counting from transcript files
- More MCP server information
- Git branch/status display
- Custom themes
- Configuration file support

### Improvements
- More terminal support
- Better error messages
- Performance optimization
- Accessibility improvements

### Testing
- More component tests
- Integration tests
- Performance benchmarks

### Documentation
- Video tutorials
- Architecture diagrams
- API documentation

## Getting Help

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Join discussions in PRs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
