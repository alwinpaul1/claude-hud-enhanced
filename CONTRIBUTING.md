# Contributing to Claude HUD

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud/tui
bun install
bun run build
```

## Project Structure

```
claude-hud/
├── .claude-plugin/
│   └── plugin.json       # Plugin manifest
├── hooks/
│   └── hooks.json        # Hook definitions
├── scripts/
│   ├── session-start.sh  # Spawns HUD on session start
│   ├── capture-event.sh  # Captures tool events
│   └── cleanup.sh        # Cleans up on session end
└── tui/
    ├── src/
    │   ├── index.tsx     # Main app entry
    │   ├── components/   # React/Ink components
    │   └── lib/          # Utilities and types
    ├── package.json
    └── tsconfig.json
```

## Running Tests

```bash
cd tui
bun test
```

## Code Style

- TypeScript strict mode
- React functional components with hooks
- No `any` types without justification

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run tests: `bun test`
5. Build: `bun run build`
6. Submit PR

## Areas for Contribution

- Additional terminal support
- More accurate context tracking
- UI improvements
- Test coverage
- Documentation
