---
description: Configure claude-hud as your statusline
---

Add this statusLine configuration to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'node \"$(ls -td ~/.claude/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | head -1)dist/index.js\"'"
  }
}
```

This command automatically finds and runs the latest installed version.

Merge with existing settings. Do not overwrite other fields.

The HUD appears immediately - no restart needed. Updates are automatic.
