---
description: Configure claude-hud as your statusline
allowed-tools: Bash, Read, Edit, AskUserQuestion
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

After successful setup, ask the user if they'd like to star the repository to support the project.

If they agree, run: `gh repo star jarrodwatts/claude-hud`

Only run the star command if they explicitly say yes.
