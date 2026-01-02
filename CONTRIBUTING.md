# Contributing to Claude HUD

Thanks for your interest in contributing! This guide will help you get started.

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
├── tui/
│   ├── src/
│   │   ├── index.tsx         # Main app, state management, event processing
│   │   ├── components/       # React/Ink UI components
│   │   │   ├── ContextMeter.tsx   # Token usage display
│   │   │   ├── ToolStream.tsx     # Tool activity list
│   │   │   ├── AgentList.tsx      # Subagent tracking
│   │   │   ├── SessionStats.tsx   # Session statistics
│   │   │   ├── TodoList.tsx       # Task tracking
│   │   │   ├── ModifiedFiles.tsx  # Changed files
│   │   │   ├── McpStatus.tsx      # MCP server status
│   │   │   ├── Sparkline.tsx      # Sparkline visualization
│   │   │   └── ErrorBoundary.tsx  # Error handling
│   │   └── lib/
│   │       ├── types.ts           # TypeScript interfaces
│   │       ├── event-reader.ts    # FIFO reader with reconnection
│   │       ├── context-tracker.ts # Token estimation and tracking
│   │       └── cost-tracker.ts    # Cost estimation
│   ├── package.json
│   ├── tsconfig.json
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

**EventReader** (`lib/event-reader.ts`)
- Reads from named pipe (FIFO)
- Handles reconnection with exponential backoff
- Emits 'event' and 'status' events

**ContextTracker** (`lib/context-tracker.ts`)
- Estimates tokens from event payloads
- Tracks burn rate over time
- Maintains token history for sparkline

**CostTracker** (`lib/cost-tracker.ts`)
- Calculates cost based on token usage
- Supports different model pricing

## Adding a New Panel

1. Create a component in `tui/src/components/`:

```tsx
import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  data: YourDataType;
}

export function YourPanel({ data }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">Your Panel</Text>
      </Box>
      {/* Panel content */}
    </Box>
  );
}
```

2. Add state in `index.tsx`:

```tsx
const [yourData, setYourData] = useState<YourDataType>(initialValue);
```

3. Process relevant events in `processEvent`:

```tsx
if (event.event === 'RelevantEvent') {
  setYourData(/* updated data */);
}
```

4. Add the component to the render tree (wrapped in ErrorBoundary).

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
