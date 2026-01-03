---
description: Configure claude-hud as your statusline
---

Add this exact statusLine configuration to ~/.claude/settings.json:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/index.js"
  }
}
```

IMPORTANT: Use the literal string `${CLAUDE_PLUGIN_ROOT}` exactly as shown - do NOT resolve or expand it. Claude Code will resolve this variable at runtime to the correct plugin path.

Merge with existing settings. Do not overwrite other fields.
