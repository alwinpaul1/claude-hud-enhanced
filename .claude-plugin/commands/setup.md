---
description: Configure claude-hud as your statusline
---

Add the following statusLine configuration to the user's ~/.claude/settings.json:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/index.js"
  }
}
```

Merge this with the existing settings.json content. Do not overwrite other fields.

After updating, confirm the change was made successfully.
