# Claude HUD Enhanced

An enhanced Claude Code plugin that shows what's happening — context usage, active tools, running agents, todo progress, **and detailed usage limits with time-to-reset countdowns**. Always visible below your input.

[![License](https://img.shields.io/github/license/alwinpaul1/claude-hud-enhanced?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/alwinpaul1/claude-hud-enhanced)](https://github.com/alwinpaul1/claude-hud-enhanced/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

## Install

Inside a Claude Code instance, run the following commands:

**Step 1: Add the enhanced marketplace**
```
/plugin marketplace add alwinpaul1/claude-hud-enhanced
```

**Step 2: Install the plugin**
```
/plugin install claude-hud-enhanced
```

**Step 3: Configure the statusline**
```
/claude-hud-enhanced:setup
```

Done! The HUD appears immediately — no restart needed.

---

## What is Claude HUD Enhanced?

Claude HUD Enhanced gives you better insights into what's happening in your Claude Code session, with **additional features** for tracking usage limits.

| What You See | Why It Matters |
|--------------|----------------|
| **Project path** | Know which project you're in (configurable 1-3 directory levels) |
| **Context health** | Know exactly how full your context window is before it's too late |
| **Tool activity** | Watch Claude read, edit, and search files as it happens |
| **Agent tracking** | See which subagents are running and what they're doing |
| **Todo progress** | Track task completion in real-time |
| **5h & 7d usage** | Always see both rate limits with reset times |
| **Model quotas** | Track Opus 4.5 and other compute-intensive model limits |
| **Max tier info** | See Max5/Max20 tier with tokens-per-window |

### Enhanced Features (vs Original)

| Feature | Original (upstream defaults) | Enhanced (this fork) |
|---------|------------------------------|----------------------|
| 7-day usage | Hidden until ≥80% | **Always visible** when data exists (`sevenDayThreshold: 0`) |
| Plan / auth label | Off by default | **On by default** (`showAuth`) from Claude Code oauth account |
| Tools / agents / todos | Off by default | **On by default** |
| Context display | Percent only | **Percent + tokens** (`contextValue: both`) |
| Separators | Off | **On** |
| Config path | `~/.claude/plugins/claude-hud/` | `~/.claude/plugins/claude-hud-enhanced/` (auto-migrates) |
| Plugin identity | `claude-hud` | **`claude-hud-enhanced`** |

## What Each Line Shows

### Session Info
```
[Opus 4.5 | Pro] █████░░░░░ 45% 90k/200k | my-project git:(main) | 5h: 25% (3h 28m) | 7d: 51% (Resets Fri 12:30 PM) | ⏱️ 5m
```
- **Model** — Current model in use (shown first)
- **Plan name** — Your subscription tier (Pro, Max, Team) when usage enabled
- **Context bar** — Visual meter with color coding (green → yellow → red as it fills)
- **Token count** — Current/total tokens (e.g., `90k/200k`)
- **Project path** — Configurable 1-3 directory levels (default: 1)
- **Git branch** — Current branch name (configurable on/off)
- **5h usage** — 5-hour rate limit with **countdown** (e.g., "3h 28m"), or reset time when limit reached
- **7d usage** — 7-day rate limit with **reset date/time** (e.g., "Resets Fri 12:30 PM")
- **Duration** — How long the session has been running

### When Limit is Reached
```
[Opus 4.5 | Pro] ░░░░░░░░░░ 0% 0/200k | my-project git:(main) | ⚠ 5h limit Resets 8:32 PM | 7d: 51% (Resets Fri 12:30 PM) | ⏱️ 1h 48m
```
- Shows warning with reset time for 5h limit
- 7-day usage with reset date/time always visible alongside

### Tool Activity
```
✓ TaskOutput ×2 | ✓ mcp_context7 ×1 | ✓ Glob ×1 | ✓ Skill ×1
```
- **Running tools** show a spinner with the target file
- **Completed tools** aggregate by type with counts

### Agent Status
```
✓ Explore: Explore home directory structure (5s)
✓ open-source-librarian: Research React hooks patterns (2s)
```
- **Agent type** and what it's working on
- **Elapsed time** for each agent

### Todo Progress
```
✓ All todos complete (5/5)
```
- **Current task** or completion status
- **Progress counter** (completed/total)

---

## How It Works

Claude HUD uses Claude Code's native **statusline API** — no separate window, no tmux required, works in any terminal.

```
Claude Code → stdin JSON → claude-hud → stdout → displayed in your terminal
           ↘ transcript JSONL (tools, agents, todos)
```

**Key features:**
- Native token data from Claude Code (not estimated)
- Parses the transcript for tool/agent activity
- Updates every ~300ms

---

## Configuration

Customize your HUD anytime:

```
/claude-hud-enhanced:configure
```

The guided flow walks you through customization — no manual editing needed:

- **First time setup**: Choose a preset (Full/Essential/Minimal), then fine-tune individual elements
- **Customize anytime**: Toggle items on/off, adjust git display style, switch layouts
- **Preview before saving**: See exactly how your HUD will look before committing changes

### Presets

| Preset | What's Shown |
|--------|--------------|
| **Full** | Everything enabled — tools, agents, todos, git, usage, duration |
| **Essential** | Activity lines + git status, minimal info clutter |
| **Minimal** | Core only — just model name and context bar |

After choosing a preset, you can turn individual elements on or off.

### Manual Configuration

You can also edit the config file directly at `~/.claude/plugins/claude-hud-enhanced/config.json`.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `lineLayout` | string | `expanded` | `compact` (single session line) or `expanded` (multi-element) |
| `showSeparators` | boolean | true | Separator between session and activity lines |
| `pathLevels` | 1-3 | 1 | Directory levels to show in project path |
| `gitStatus.enabled` | boolean | true | Show git branch in HUD |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | true | Show `↑N ↓N` for ahead/behind remote |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.contextValue` | string | `both` | `percent`, `tokens`, or `both` |
| `display.showAuth` | boolean | true | Show plan/auth label from Claude Code login |
| `display.showDuration` | boolean | true | Show session duration |
| `display.showUsage` | boolean | true | Show 5h/7d usage from stdin `rate_limits` |
| `display.idleUsageReset` | boolean | false | While idle, show a window as reset (~0%) once its reset time passes (local-only) |
| `display.oauthUsagePoll` | boolean | false | Hybrid usage sync: idle terminals pick up usage from active ones via a shared per-profile snapshot (local), and while fully idle a detached OAuth refresher keeps usage live across devices (reads your Claude Code OAuth token read-only, calls Anthropic's `oauth/usage` endpoint; 180s TTL, single-flight, backoff) |
| `display.sevenDayThreshold` | number | 0 | Min 7d % before weekly shows (0 = always) |
| `display.showTools` | boolean | true | Show tools activity line |
| `display.showAgents` | boolean | true | Show agents activity line |
| `display.showTodos` | boolean | true | Show todos progress line |

### Usage Limits (Pro/Max/Team)

Usage display is **enabled by default** for Claude Pro, Max, and Team subscribers. It shows your rate limit consumption directly in the HUD.

**Enhanced behavior:** Both 5-hour AND 7-day usage are **always visible**:
- **5h** — Shows countdown (e.g., "3h 28m") or reset time when limit reached
- **7d** — Shows date/time (e.g., "Resets Fri 12:30 PM")

```
[Opus 4.5 | Pro] █████░░░░░ 45% 90k/200k | my-project | 5h: 25% (3h 28m) | 7d: 51% (Resets Fri 12:30 PM) | ⏱️ 5m
```

**When limit is reached:**
```
[Opus 4.5 | Pro] ░░░░░░░░░░ 0% | my-project | ⚠ 5h limit Resets 8:32 PM | 7d: 51% (Resets Fri 12:30 PM)
```

**Max tier detection** (Max5 = 88k tokens/window, Max20 = 220k tokens/window):
```
[Opus 4.5 | Max] █████░░░░░ 45% | my-project | 5h: 25% | 7d: 51% (Resets Fri 12:30 PM) | Max20 220k/win
```

To disable usage display, set `display.showUsage` to `false` in your config.

**Requirements:**
- Claude Pro, Max, or Team for rate-limit windows (API-key users typically have no `rate_limits` in stdin)
- Claude Code login so stdin can include `rate_limits` and `{CLAUDE_CONFIG_DIR}.json` can expose plan/auth

**How usage + plan are read (0.3.0+):**
- **Usage** — native Claude Code stdin `rate_limits` (5h / 7d), not a separate Anthropic usage API call
- **Plan / auth** — `auth.ts` reads the Claude Code oauth account profile in `{CLAUDE_CONFIG_DIR}.json` (e.g. `~/.claude.json`)

**Idle usage refresh (`display.idleUsageReset`, opt-in):** Claude Code only refreshes `rate_limits` on stdin when you send a message, so between messages the numbers are frozen. With this on, once a window's reset time has passed while you're idle the HUD shows that window as reset (~0%) and rolls its reset forward — the true value, since your own usage on this machine can't rise without a message. It stays **local-only** (no network, no API calls). Scope: it only zeroes on rollover — it does not reflect usage burned on *other* devices while this machine is idle, and the percentage between resets is the last stdin snapshot.

**Hybrid usage sync (`display.oauthUsagePoll`, opt-in):** keeps a shared per-profile snapshot (`usage-snapshot.json` in the HUD data dir). When any active terminal's stdin advances the usage numbers, the snapshot is updated — and other, idle terminals on the same machine serve that fresher value instead of their frozen stdin. Fully local. Idle is detected as "stdin stopped advancing" (Claude Code re-sends frozen values while idle). When the machine goes fully idle (snapshot older than 180s), a detached OAuth refresher (`dist/refresh-usage.js`) fetches the account-wide numbers so usage burned on **other devices** shows up too. Privacy/scope notes: it reads your Claude Code OAuth token **read-only** (macOS Keychain, else `.credentials.json`) and sends it only to its issuer — Anthropic's (undocumented) `api.anthropic.com/api/oauth/usage` endpoint, the same one ccstatusline uses; at most ~1 request per 3 minutes per profile machine-wide (single-flight lock + TTL + `Retry-After`-aware backoff), never on the render path, and `HTTPS_PROXY` is not honored. This is the one opt-in exception to the local-only rule; leave the flag off to stay fully local.

**Troubleshooting:** If usage doesn't appear:
- Ensure you're logged in with a Pro/Max/Team account (not API-only)
- Check `display.showUsage` is not set to `false`
- Wait until Claude Code has emitted `rate_limits` at least once this session
- Confirm config lives under `~/.claude/plugins/claude-hud-enhanced/config.json`

### Layout Options

**Compact** (`lineLayout: "compact"`) — single session line:
```
[Opus] ████░░░░░░ 42% (45k/200k) | my-project git:(main) | ⏱️ 5m
```

**Expanded** (default, `lineLayout: "expanded"`) — multi-element layout with separators:
```
[Opus] │ my-project
Context ████░░░░░░ 42% (45k/200k)
─────────────────────────────────
✓ Read ×3 | ✓ Edit ×1
```

### Example Configuration

```json
{
  "lineLayout": "expanded",
  "showSeparators": true,
  "pathLevels": 2,
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true
  },
  "display": {
    "showModel": true,
    "showContextBar": true,
    "contextValue": "both",
    "showAuth": true,
    "showDuration": true,
    "showUsage": true,
    "sevenDayThreshold": 0,
    "showTools": true,
    "showAgents": true,
    "showTodos": true
  }
}
```

### Display Examples

**1 level (default):** `[Opus] 45% | my-project git:(main) | ...`

**2 levels:** `[Opus] 45% | apps/my-project git:(main) | ...`

**3 levels:** `[Opus] 45% | dev/apps/my-project git:(main) | ...`

**With dirty indicator:** `[Opus] 45% | my-project git:(main*) | ...`

**With ahead/behind:** `[Opus] 45% | my-project git:(main ↑2 ↓1) | ...`

**Minimal display (only context %):** Configure `showModel`, `showContextBar`, `showConfigCounts`, `showDuration` to `false`

### Troubleshooting

**Config not applying?**
- Check for JSON syntax errors: invalid JSON silently falls back to defaults
- Ensure valid values: `pathLevels` must be 1, 2, or 3; `lineLayout` must be `compact` or `expanded`
- Delete config and run `/claude-hud-enhanced:configure` to regenerate

**Git status missing?**
- Verify you're in a git repository
- Check `gitStatus.enabled` is not `false` in config

**Tool/agent/todo lines missing?**
- These only appear when there's activity to show
- Check `display.showTools`, `display.showAgents`, `display.showTodos` in config

---

## Requirements

- Claude Code v1.0.80+
- Node.js 18+ or Bun

---

## Development

```bash
git clone https://github.com/alwinpaul1/claude-hud-enhanced
cd claude-hud-enhanced
npm ci && npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Credits

This is an enhanced fork of [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud). 

**Enhancements by [@alwinpaul1](https://github.com/alwinpaul1):**
- Identity + data dir under `claude-hud-enhanced` (auto-migrates legacy path)
- Always-visible 7-day usage (`sevenDayThreshold: 0`)
- Plan/auth on by default via Claude Code oauth account profile
- Richer defaults (tools/agents/todos/separators/context both)
- Rebased on upstream v0.5.1 architecture (auth, effort, external usage, expanded layout)

---

## License

MIT — see [LICENSE](LICENSE)

---

## Star History

[![GitHub stars](https://img.shields.io/github/stars/alwinpaul1/claude-hud-enhanced?style=social)](https://star-history.com/#alwinpaul1/claude-hud-enhanced&Date)

*(click for the interactive star-history chart)*