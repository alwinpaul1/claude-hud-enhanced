# Changelog

All notable changes to Claude HUD will be documented in this file.

## [0.2.22] - 2026-04-17

### Changed
- `Usage` and `Weekly` segments now render on their own second row by default in `compact` layout, keeping the main session line (model + context bar + project + git + counts) clean.
- New config `display.usageOnNewLine` (default `true`). Set to `false` to restore the old single-line layout where usage is appended to the main row.

## [0.2.21] - 2026-04-17

### Removed
- **Output speed display (`out: X.X tok/s`)** — removed entirely. Deleted `src/speed-tracker.ts`, the `display.showSpeed` config field, `format.out` / `format.tokPerSec` i18n keys, render blocks in `session-line.ts` and `project.ts`, and the `speed-tracker.test.js` test suite.

### Changed
- `display.showClaudeMdCount` now defaults to `true`. `N CLAUDE.md` is shown alongside `N MCPs | N hooks` by default.

## [0.2.20] - 2026-04-17

### Changed
- Split `showConfigCounts` into per-type toggles: `showClaudeMdCount`, `showRulesCount`, `showMcpCount`, `showHooksCount`. **MCPs and hooks now show by default**; CLAUDE.md and rules are opt-in.
- `showConfigCounts: true` (the legacy master) still forces all four on for backwards compatibility.

## [0.2.19] - 2026-04-17

### Changed
- Plan auto-detection (`src/oauth.ts`) now mirrors upstream's robustness:
  - macOS Keychain uses multiple service names (`Claude Code-credentials` plus hashed suffix for custom `CLAUDE_CONFIG_DIR`), tries account-name then anonymous lookup, uses absolute `/usr/bin/security` path, and skips expired tokens (`expiresAt <= now`).
  - Keychain failure backoff (60s) prevents repeated prompts on every ~300ms statusline tick.

### Added
- **Linux**: Best-effort libsecret support via `secret-tool lookup service "Claude Code-credentials" account $USER`. No-op if `secret-tool` is not installed.
- **Windows**: Best-effort Windows Credential Manager support via PowerShell + `Get-StoredCredential`. No-op if the CredentialManager module is unavailable.
- File fallback (`~/.claude/.credentials.json`) still runs last on all platforms.

## [0.2.18] - 2026-04-17

### Added
- Auto-detect the user's plan (`Pro`, `Max 5x`, `Max 20x`, `Team`, `Enterprise`) from the OAuth credentials and append it as a qualifier next to the model: `[Opus 4.7 | Max 5x]`. Credentials are read from macOS Keychain (`security find-generic-password -s "Claude Code-credentials"`) or `~/.claude/.credentials.json` on Linux/Windows. Result is cached for 1 hour in `~/.claude/plugins/claude-hud/oauth-cache.json` so the shell-out only runs once per hour.
- New config toggle `display.showPlan` (default `true`). Set to `false` to hide the plan qualifier.

### Notes
- If `display.modelOverride` is non-empty it still wins — the plan qualifier is suppressed so the user's override string is shown verbatim. Clear `modelOverride` to opt into auto-detection.

## [0.2.17] - 2026-04-17

### Changed
- `display.showConfigCounts` now defaults to `false`. The `N CLAUDE.md | N MCPs | N hooks` segment is hidden out of the box; set `display.showConfigCounts: true` in the plugin config to opt back in.

## [0.2.16] - 2026-04-17

### Fixed
- Limit-reached branch now shows reset as clock time (`(resets 9:00 PM)` for 5h, `(resets Thu 9:00 PM)` for 7d) instead of the `24m` countdown — matches the normal usage display format.
- Weekly segment stays visible next to the 5h `⚠ Limit reached` warning so users still see their 7-day standing while the 5h is blocked.

## [0.2.15] - 2026-04-17

### Added
- Persist stdin `rate_limits` to `~/.claude/plugins/claude-hud/usage-cache.json` and fall back to it on sessions where Claude Code has not yet pushed rate_limits into stdin (fresh session start, before first API call). Cache entries with expired reset timestamps are filtered out per-window so stale values never show. The HUD now keeps showing Usage/Weekly immediately on session start instead of rendering a line without the usage section.

## [0.2.14] - 2026-04-17

### Changed
- 5-hour reset now shows just time-of-day (e.g. `(resets 9:00 PM)`) without the weekday. The 5h window always resets within the same day, so the weekday prefix was redundant. Weekly keeps its `(resets Thu 9:00 PM)` weekday+time format.

## [0.2.13] - 2026-04-17

### Changed
- 5-hour window reset now renders as weekday+time (e.g. `(resets Thu 9:00 PM)`), matching the Weekly format. Replaces the `(51m)` countdown to tell users the exact clock time when their rate limit lifts.

## [0.2.12] - 2026-04-17

### Changed
- Drop the redundant window-label suffix from the countdown in the compact session line: `(55m / 5h)` → `(55m)`. The `5h` window was already implied by the `Usage` label + bar context. Weekly datetime format unchanged.

## [0.2.11] - 2026-04-17

### Changed
- `display.showSessionName` now defaults to `false`. The auto-generated session slug (e.g. `breezy-enchanting-map`) cluttered the compact line without adding actionable context. Users who want it can opt back in via `display.showSessionName: true`.

## [0.2.10] - 2026-04-17

### Changed
- Usage/Weekly quota colors now follow the same green/yellow/red thresholds as the context bar, matching the pre-upstream-sync-backup `getContextColor` mapping exactly: `<70` → `colors.context` (green), `70–84` → `colors.warning` (yellow), `>=85` → `colors.critical` (red). Replaces both the magenta upstream default (0.2.8) and the flat blue attempt (0.2.9) with the threshold palette the fork originally used.

## [0.2.9] - 2026-04-17

### Changed
- Usage/Weekly quota bars now render in a single flat color (`colors.usage`, bright blue by default) regardless of percent, matching the pre-sync-backup look. The previous threshold-based color change (blue → magenta at 75% → red at 90%) was distracting and duplicative with the percentage text. At-limit state still rendered separately by `critical` color.

## [0.2.8] - 2026-04-17

### Changed
- `display.showCost` now defaults to `false`. The estimated cost adds noise and Usage/Weekly windows already convey spend pressure. Users can opt back in via `display.showCost: true`.

## [0.2.7] - 2026-04-17

### Changed
- `display.showSessionTokens` now defaults to `false`. The inline `tok: X` summary and the dedicated session-tokens line are hidden by default — context usage and Usage/Weekly windows already tell the story. Users who want cumulative session tokens can opt back in via config.

## [0.2.6] - 2026-04-17

### Changed
- Shorten the inline session-tokens summary in the compact session line from `tok: 83.1M (in: 842, out: 28k)` to just `tok: 83.1M`. The in/out breakdown was consistently getting truncated mid-word on realistic terminal widths. Users who still want the full breakdown get it on the dedicated session-tokens line (expanded layout or `showSessionTokens` as its own line).

## [0.2.5] - 2026-04-17

### Changed
- `display.showClaudeCodeVersion` now defaults to `false` — the Claude Code version label is no longer shown in the HUD unless explicitly enabled in `~/.claude/plugins/claude-hud/config.json`. Keeps the statusline shorter and avoids redundancy with `claude --version` etc.

## [0.2.4] - 2026-04-17

### Changed
- Weekly (7-day) usage reset now shows actual weekday + time (e.g. `(resets Fri 12:30 PM)`) instead of a countdown like `(6d 2h / Weekly)`. Matches the pre-sync-backup behavior. The 5-hour window keeps its shorter `(resets in 1h 58m)` countdown.

## [0.2.3] - 2026-04-17

### Changed
- Default every optional display boolean to `true` so fresh installs see the full HUD surface out of the box: tools, agents, todos, config counts, cost, duration, speed, session name, Claude Code version, memory, session tokens, output style, git ahead/behind + file stats, and section separators are all on by default. Users who preferred the minimal look can disable individual items via `/claude-hud-enhanced:configure` or by setting them to `false` in `~/.claude/plugins/claude-hud/config.json`.

## [0.2.2] - 2026-04-17

### Changed
- Rename semantics of `display.wrapLines` so `true` reads as "let the terminal wrap naturally" (its new, and default, behavior). `display.wrapLines: true` (default) emits one logical line per rendered row and defers to the terminal's natural soft-wrap — matching the pre-sync horizontal look. `display.wrapLines: false` restores 0.2.0's hard-split-at- ` | ` behavior when a line exceeds terminal width.

## [0.2.1] - 2026-04-17

### Added
- Initial `display.wrapLines` config option (inverted semantics; superseded in 0.2.2).

## [0.2.0] - 2026-04-17

### Added
- Full synchronization with upstream `jarrodwatts/claude-hud` v0.0.12, pulling 418 upstream commits into the marketplace layout
- Rewritten multi-line render architecture (`src/render/lines/*`)
- Native stdin cost field (`cost.total_cost_usd`) with safe fallback to offline estimate
- Offline estimated cost display via `display.showCost` for known Anthropic model families
- i18n support — English default, opt-in Chinese (`zh`) HUD labels
- Session token cumulative usage summary
- Output speed tracking (tok/s) and output-style display toggle
- Git per-file diffs with OSC 8 clickable hyperlinks and dedicated files line
- Configurable `display.modelFormat` (full/compact/short) and `display.modelOverride`
- `display.customLine` support for a short custom HUD phrase
- Configurable element colors (256-color indices and hex values)
- `--extra-cmd` CLI argument for custom status labels
- Bedrock provider detection and `vm_stat`-based macOS memory reporting

### Changed
- Usage now derived solely from Claude Code's stdin `rate_limits` — OAuth polling, cache/lock behavior, and credential-derived plan labels removed
- Bounded stdin reads to prevent statusline hangs
- Narrow-terminal wrapping and OSC hyperlink width handling improved
- Plugin detection, config caching, and transcript-derived metadata hardened with broader test coverage

### Removed
- Legacy fork patches superseded upstream: 120s failure cache TTL, `api.claude.ai` endpoint fix, hand-rolled plan-name stripping, bespoke 5h/7d reset format (upstream's `render/lines/usage.ts` now owns these)

## [0.1.7] - 2026-03-07

### Fixed
- Setup: replace `ls -d | awk` with simpler `ls` for version resolution (fixes quoting breakage on MSYS2/Git Bash)
- Setup: add `exec` to bash -c wrapper for proper stdin pipe forwarding
- Configure: fix config path from `claude-hud-enhanced` to `claude-hud` to match actual code path
- CACHE_VERSION now read from package.json instead of hardcoded (stays in sync on version bumps)
- Tests: fix stale `getGitBranch` references → `getGitStatus`, remove invalid `condensed` layout

---

## [0.1.6] - 2026-03-05

### Fixed
- Restructure repo to official marketplace layout (`plugins/claude-hud-enhanced/`) so "Update now" works
- Plugin was treated as local due to `"source": "./"` — changed to `"source": "./plugins/claude-hud-enhanced"`

### Added
- Auto-invalidate usage cache on plugin update (version-stamped cache entries)
- POSIX-portable semver sort for version resolution
- Proper `[version]` cast in PowerShell setup for correct semver sorting

---

## [0.0.9] - 2026-03-05

### Added
- Show plan name in model bracket: `[Opus 4.6 | Max]`
- Max tier detection (Max5/Max20) from `rateLimitTier` credentials with underscore variants (`default_claude_max_5x`)
- Max tier info displays even when usage API is unavailable

### Fixed
- Remove non-existent `api.claude.ai` endpoint that caused persistent 429 rate limiting
- Increase failure cache TTL from 15s to 120s to avoid retry storms

---

## [0.0.8] - 2026-03-05

### Fixed
- Windows setup: shell detection, `.exe` resolution, no PowerShell wrapper
- Fix minimatch ReDoS vulnerability (CVE high severity)

---

## [0.0.7] - 2026-02-15

### Changed
- Version bump

---

## [0.0.6] - 2026-02-09

### Changed
- Version bump

---

## [0.0.5] - 2026-02-06

### Fixed
- Fix all command references from `claude-hud` to `claude-hud-enhanced` across docs
  - Resolves "Unknown skill: claude-hud:setup" error during installation
  - Updated config paths to `~/.claude/plugins/claude-hud-enhanced/`
  - Updated repo URLs in CLAUDE.README.md

### Changed
- Context percentage now uses percentage-based buffer (22.5%) instead of hardcoded 45k tokens
  - Scales correctly for enterprise context windows (>200k)
- Add `display.autocompactBuffer` config option (`'enabled'` | `'disabled'`, default: `'enabled'`)
  - `'enabled'`: Shows buffered % (matches `/context` when autocompact ON) - **default**
  - `'disabled'`: Shows raw % (matches `/context` when autocompact OFF)

### Credits
- Ideas from [#30](https://github.com/jarrodwatts/claude-hud/pull/30) ([@r-firpo](https://github.com/r-firpo)), [#43](https://github.com/jarrodwatts/claude-hud/pull/43) ([@yansircc](https://github.com/yansircc)), [#49](https://github.com/jarrodwatts/claude-hud/pull/49) ([@StephenJoshii](https://github.com/StephenJoshii)) informed the final solution

---

## [0.0.4] - 2026-01-07

### Added
- Configuration system via `~/.claude/plugins/claude-hud-enhanced/config.json`
- Interactive `/claude-hud-enhanced:configure` skill for in-Claude configuration
- Usage API integration showing 5h/7d rate limits (Pro/Max/Team)
- Git status with dirty indicator and ahead/behind counts
- Configurable path levels (1-3 directory segments)
- Layout options: default and separators
- Display toggles for all HUD elements

### Fixed
- Git status spacing: `main*↑2↓1` → `main* ↑2 ↓1`
- Root path rendering: show `/` instead of empty
- Windows path normalization

### Credits
- Config system, layouts, path levels, git toggle by @Tsopic (#32)
- Usage API, configure skill, bug fixes by @melon-hub (#34)

---

## [0.0.3] - 2025-01-06

### Added
- Display git branch name in session line (#23)
- Display project folder name in session line (#18)
- Dynamic platform and runtime detection in setup command (#24)

### Changed
- Remove redundant COMPACT warning at high context usage (#27)

### Fixed
- Skip auto-review for fork PRs to prevent CI failures (#25)

### Dependencies
- Bump @types/node from 20.19.27 to 25.0.3 (#2)

---

## [0.0.2] - 2025-01-04

### Security
- Add CI workflow to build dist/ after merge - closes attack vector where malicious code could be injected via compiled output in PRs
- Remove dist/ from git tracking - PRs now contain source only, CI handles compilation

### Fixed
- Add 45k token autocompact buffer to context percentage calculation - now matches `/context` output accurately by accounting for Claude Code's reserved autocompact space
- Fix CI caching with package-lock.json
- Use Opus 4.5 for GitHub Actions code review

### Changed
- Setup command now auto-detects installed plugin version (no manual path updates needed)
- Setup prompts for optional GitHub star after successful configuration
- Remove husky pre-commit hook (CI now handles dist/ compilation)

### Dependencies
- Bump c8 from 9.1.0 to 10.1.3

---

## [0.0.1] - 2025-01-04

Initial release of Claude HUD as a Claude Code statusline plugin.

### Features
- Real-time context usage monitoring with color-coded progress bar
- Active tool tracking with completion counts
- Running agent status with elapsed time
- Todo progress display
- Native token data from Claude Code stdin
- Transcript parsing for tool/agent/todo activity
