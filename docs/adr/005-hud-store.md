# 005 - HUD Store and Reducer Architecture

## Status
Accepted

## Context
The HUD app was previously managing IO and state derivation inside a React hook.
That mixed FIFO reading, settings/config scanning, and UI state updates in one
place, which made testing and reuse difficult.

## Decision
Introduce a `HudStore` that owns IO and side effects, and a pure reducer for
state transitions.

- `tui/src/state/hud-store.ts` manages EventReader, trackers, and environment
  refresh intervals.
- `tui/src/state/hud-reducer.ts` handles event-driven state transitions.
- `tui/src/state/hud-state.ts` defines public state and internal tracking.

## Consequences
- UI code subscribes to a stable store and stays focused on rendering.
- Event handling is testable in isolation via reducer tests.
- Future renderers can reuse the store without React.
