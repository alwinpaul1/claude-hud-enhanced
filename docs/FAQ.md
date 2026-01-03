# FAQ

## Does Claude HUD change Claude's outputs or prompts?

No. Claude HUD is read-only. It listens to Claude Code hook events and renders a UI, but it does not modify prompts, tools, or outputs.

## Does it work if my terminal doesn't support splits?

Yes. Claude HUD tries to open a split pane when supported (tmux, iTerm2, Kitty, WezTerm, Zellij, Windows Terminal WSL). If splits are not available, it falls back to a separate window or background process.

## How do I uninstall?

```bash
claude /plugin uninstall claude-hud
```

## Does it require network access?

No. The HUD runs locally and only reads Claude Code hook events.

## What does it depend on?

- Claude Code (v1.0.33+)
- Node.js 18+ or Bun
- `jq` for JSON parsing in hook scripts

## What data does it read?

It consumes Claude Code hook payloads and session events. It does not read your code unless a hook event includes metadata (like file paths) that Claude Code already exposes.

## Where are runtime files stored?

Under `~/.claude/hud/`:
- `events/<session_id>.fifo` for the event stream
- `pids/<session_id>.pid` for process tracking
- `logs/<session_id>.log` for fallback logs

## How do I debug it?

```bash
CLAUDE_HUD_DEBUG=1 claude
claude --debug hooks
```

For more, see `TROUBLESHOOTING.md`.
