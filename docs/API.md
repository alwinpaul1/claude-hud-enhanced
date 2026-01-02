# API Contracts

## HUD Event Schema (v1)

All events written to the HUD FIFO must include `schemaVersion: 1`. The HUD
will ignore events with an unknown schema version.

### Required fields
- `schemaVersion`: number (current: `1`)
- `event`: string (e.g., `PreToolUse`, `PostToolUse`, `Stop`)
- `session`: string
- `ts`: number (epoch seconds)

### Optional fields
- `tool`: string or null
- `toolUseId`: string
- `input`: object or null
- `response`: object or null
- `permissionMode`: string
- `transcriptPath`: string
- `cwd`: string
- `prompt`: string

### Example
```json
{
  "schemaVersion": 1,
  "event": "PostToolUse",
  "tool": "Read",
  "toolUseId": "tool-1",
  "input": { "file_path": "README.md" },
  "response": { "duration_ms": 120 },
  "session": "abc123",
  "ts": 1700000000
}
```
