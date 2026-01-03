---
description: Configure claude-hud as your statusline
---

Add statusLine configuration to ~/.claude/settings.json.

First, find the installed plugin path:
- Look in ~/.claude/plugins/cache/claude-hud/claude-hud/ for the version folder
- The path will be like: ~/.claude/plugins/cache/claude-hud/claude-hud/{version}/dist/index.js

Add this to settings.json (using the actual path you found):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/cache/claude-hud/claude-hud/{version}/dist/index.js"
  }
}
```

Replace {version} with the actual version folder name (e.g., 0.0.1).

Merge with existing settings. Do not overwrite other fields.

The HUD appears immediately - no restart needed.
