# Repository Guidelines

## Project Structure & Module Organization
- `tui/` houses the TypeScript/React Ink HUD app.
  - `tui/src/components/` for UI panels (e.g., `ContextMeter.tsx`).
  - `tui/src/hooks/` for shared state hooks (e.g., `useHudState.ts`).
  - `tui/src/lib/` for core logic (event reader, tracking, types).
- `scripts/` contains shell entrypoints used by Claude hooks.
- `hooks/` defines event subscriptions (`hooks.json`).
- `docs/` stores changelog, ADRs, and research notes.

## Build, Test, and Development Commands
Run commands from `tui/` unless noted.
- `bun install` installs dependencies.
- `bun run build` compiles TypeScript to `tui/dist/`.
- `bun run dev` watches TypeScript for local development.
- `bun run start` runs the built HUD (`dist/index.js`).
- `bun test` runs the Vitest suite; `bun test <pattern>` targets a file.
- `bun run lint` runs ESLint; `bun run format` runs Prettier.
- Root `scripts/verify-install.sh` checks plugin installation.

## Coding Style & Naming Conventions
- TypeScript strict mode; avoid `any` (use `unknown` or real types).
- React functional components with hooks; wrap panels in `React.memo`.
- Tests live alongside code and use `*.test.ts`/`*.test.tsx`.
- Formatting via Prettier, linting via ESLint flat config (`tui/eslint.config.js`).

## Testing Guidelines
- Frameworks: Vitest + @testing-library/react + ink-testing-library.
- Prefer focused component/unit tests under `tui/src/`.
- Run all tests with `bun test`; use `bun test --coverage` for coverage.

## Commit & Pull Request Guidelines
- Commit messages follow `type: summary` (examples: `docs: ...`, `refactor: ...`).
- PRs should include a clear description, tests for new behavior, and any UI
  screenshots for visual changes in the TUI.
- Before opening a PR: run `bun run lint`, `bun run typecheck`, and `bun test`.

## Security & Configuration Tips
- Runtime FIFOs and logs live under `~/.claude/hud/` (sessions, pids, logs).
- Hook scripts rely on `jq`; ensure it is available in local dev.
