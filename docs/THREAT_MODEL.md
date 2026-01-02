# Threat Model

## Scope

Claude HUD reads local files and hook event streams to render a terminal UI.
It does not handle network input directly.

## Assets

- Hook event payloads (tool usage, prompts, timings).
- Local configuration and settings files.
- Rendered UI state (context usage, costs, agents).

## Trust Boundaries

- `scripts/capture-event.sh` writes events into a FIFO.
- HUD reads from the FIFO and local filesystem paths under `$HOME/.claude`.

## Threats

- Malformed events causing crashes or incorrect state.
- Untrusted file contents in settings or config leading to parsing failures.
- Excessive event volume causing UI thrashing or degraded UX.

## Mitigations

- Schema versioning and validation for HUD events.
- Safe mode fallback when settings/config parsing fails.
- Render-rate cap to coalesce event bursts.
- Logging for parse failures and read errors.
