# Changelog

## [0.4.10] - 2026-07-19

### Changed
- **Setup now benchmarks the machine and picks the fastest safe `refreshInterval` (2/5/10s)** instead of a flat 5s. The idle-repaint cost is the HUD's own render time (runtime spawn + transcript parse + git), which varies ~30× across hardware: Apple Silicon + bun renders in ~90ms warm (2s is cheap, ~5% of a core), older Intel/node lands 150–500ms (5s), and slow-spawn environments (Windows especially) can exceed 500ms (10s; Windows also gets a hard floor of 5s). The interval must comfortably exceed the render time — Claude Code cancels in-flight runs on each new tick, so an interval the render can't keep up with means the HUD may never finish a paint (the failure mode ccstatusline's diagnostics warn about for inline commands ≤2s). Setup times 3 runs of the generated command and picks the tier from the fastest.

## [0.4.9] - 2026-07-19

### Fixed
- **Setup now writes `statusLine.refreshInterval: 5` — required for any idle-time updates.** Root cause of "idle terminals never pick up usage from active ones": Claude Code only re-runs the statusline on conversation events (new assistant message, `/compact`, permission-mode/vim-mode change; debounced 300ms) and those triggers **go quiet while a session is idle** — so an idle terminal's HUD froze at its last render no matter what the plugin computed. The hybrid usage sync (0.4.6), idle usage reset (0.4.5), and the all-idle OAuth refresher trigger (0.4.7) all depend on idle repaints; the 5s refresh timer makes them actually visible/fire. Existing installs: add `"refreshInterval": 5` to the `statusLine` block in `settings.json` (or re-run `/claude-hud-enhanced:setup`). Docs corrected — the HUD is *not* invoked every ~300ms unconditionally.

## [0.4.8] - 2026-07-19

### Fixed
- **Usage is hidden for Vertex sessions, like Bedrock.** `shouldHideUsage` only excluded Bedrock; with the 0.4.7 hybrid snapshot able to backfill usage while stdin has no `rate_limits`, a Vertex (API-billed) session could show subscription usage windows that don't apply to it. The hide rule is now: Bedrock (env or `anthropic.claude-*` model id) and Vertex (`CLAUDE_CODE_USE_VERTEX=1`). Enterprise plan-mode aliases (`opusplan`, `sonnetplan`, `haikuplan`) intentionally keep usage visible — they are subscription aliases with real usage windows. Usage remains shown by default for all OAuth/subscription sessions (`showUsage` default unchanged).

## [0.4.7] - 2026-07-19

### Added
- **OAuth idle usage refresher now ships (`dist/refresh-usage.js`)** — completes the `display.oauthUsagePoll` feature from 0.4.6 with the cross-**device** half: when the machine is fully idle (shared snapshot older than 180s), a detached child fetches the account-wide 5h/7d usage from Anthropic's `oauth/usage` endpoint, so usage burned on another device shows up in every terminal's HUD within ~3 minutes. Token-read + endpoint shape ported from ccstatusline (`src/utils/usage-fetch.ts`): Claude Code OAuth token read **read-only** from the macOS Keychain (`Claude Code-credentials`), falling back to `${CLAUDE_CONFIG_DIR}/.credentials.json`; never written back. Rate-limit hygiene: single-flight `wx` lock + 180s TTL cap requests at ~1 per 3 min per profile machine-wide regardless of terminal count, failures preserve last-good values without bumping the idle-TTL clock and set backoff (429 → `Retry-After` or 2×TTL, error 5 min, auth-expired 30 min — fixes the ccstatusline #204 retry-storm shape), 5s fetch timeout, 15s watchdog, lock always released in `finally`. Deviations from ccstatusline, both to stay dependency-free: global `fetch` instead of `https` + `https-proxy-agent` (so `HTTPS_PROXY` is **not** honored), and no `dump-keychain` candidate sweep. The flag stays opt-in, default off — enabling it is the one exception to the README's local-only rule, and the token goes only to its issuer (`api.anthropic.com`).

### Changed
- README: `oauthUsagePoll` docs updated — the refresher is no longer "owner-supplied"; documented the network behavior, privacy scope, and request-rate ceiling.

## [0.4.6] - 2026-07-19

### Added
- **`display.oauthUsagePoll`** (opt-in, default off): hybrid usage resolution backed by a per-profile shared snapshot. What it does **today**: cross-**terminal** usage sync — with several sessions open on one machine, an idle terminal's HUD picks up the fresher usage an active terminal just wrote (stdin advances → snapshot updated → idle terminals serve it when strictly newer), fully local, no network. Idle detection is "stdin stopped advancing" (Claude Code re-sends frozen `rate_limits` while idle, so stdin never disappears). Monotonic newer-detection (reset time before percent) guarantees a previous-window snapshot can never beat post-reset stdin, and stdin-only extras (model-scoped windows, balance label) survive snapshot serving. The flag also wires an optional detached OAuth refresher for cross-**device** live usage: the HUD spawns `dist/refresh-usage.js` (180s TTL, single-flight `wx` lock, backoff) **only if that file exists** — it is intentionally not shipped (it would read the Claude Code OAuth token and call an undocumented endpoint); see `docs/oauth-usage-poll-handoff.md` to add it yourself. Without it the refresher path is a clean no-op (no lock churn).

## [0.4.5] - 2026-07-18

### Added
- **`display.idleUsageReset`** (opt-in, default off): local idle usage refresh, no network. Claude Code only refreshes stdin `rate_limits` on a message, so between messages the numbers are frozen. With this on, once a usage window's reset time has passed while idle the HUD shows that window as reset (~0%) and rolls its reset forward — the true value, since your own usage on this machine can't rise without a message. Stays **local-only** (no API calls, no undocumented endpoints). Scope: it only zeroes on rollover — it doesn't reflect usage burned on *other* devices while this machine is idle, and the percentage between resets is the last stdin snapshot. (Chosen over a CodexBar-style OAuth poll, which would require reading credentials + calling an undocumented endpoint and couldn't be verified before shipping.)

## [0.4.4] - 2026-07-18

### Added
- **`display.compactSingleRow`** (compact layout, default off): keeps the header a tight **2-row** pair — the session line and the usage line each stay a single physical row. When the session line is wider than the terminal, the overflow (e.g. `⏱️` duration, trailing counts) is dropped at a segment boundary instead of wrapping onto a third row. Activity lines (tools/agents/todos) still wrap normally, and the default behavior is unchanged (wrap) so long git branch names / 5h continuation handling are preserved.

## [0.4.3] - 2026-07-18

### Fixed
- **Plan/auth label (and MCP/rules counts) now resolve for custom `CLAUDE_CONFIG_DIR` profiles.** The account was only looked up at the sibling `${CLAUDE_CONFIG_DIR}.json`, which is correct for the default `~/.claude` profile (`~/.claude.json`) but wrong for a custom profile like `~/.claude-work`, where Claude Code stores the config **inside** the dir at `${CLAUDE_CONFIG_DIR}/.claude.json`. As a result a work/Team profile showed no plan. `getClaudeConfigJsonPath` now prefers the inside `${configDir}/.claude.json` when it exists and falls back to the sibling for the default profile.

## [0.4.2] - 2026-07-18

### Fixed
- **Weekly reset now always shows its weekday** (`resets Sat 3:00 AM`). 0.4.1 only showed the weekday when the reset was a different calendar day *and* strictly under 7 days away — so a freshly-reset weekly window (~7 days out) fell back to `month/day`, and a weekly resetting later today collapsed to time-only. The long-window format now names the weekday for any reset within ~8 days (including later today), keeping month/day only for unusually distant windows. The 5-hour window is unchanged (clock time only).

## [0.4.1] - 2026-07-18

### Changed
- **Cleaner absolute reset times.** The `timeFormat: 'absolute'` reset label is now window-aware and drops the `at` preposition:
  - 5-hour window → **clock time only** (`resets 5:00 AM`), even across a midnight roll.
  - Weekly window → **weekday + time within the coming week** (`resets Sun 3:00 AM`), month/day beyond a week, clock-only when it resets today.
  - Hours render without a leading zero (`3:20 AM`, not `03:20 AM`), and the `at` prefix is gone (was `resets at Jul 18 03:20 AM`).
  - Applies to both compact and expanded layouts and the limit-reached label; the English `format.absoluteTime` now matches the zh locales (`{time}`).

### Changed
- **New default look — the rich compact HUD ships out of the box.** A config-less install now renders the "enhanced" two-row layout instead of the stock expanded one. Flipped `DEFAULT_CONFIG`:
  - `lineLayout`: `expanded` → **`compact`**
  - `display.showAuthInModel`: → **`true`** (plan folded into the model bracket, e.g. `[Opus 4.8 | Max 20x]`)
  - `display.authShortLabel`: → **`true`** (`Max 20x`, not `Claude Max 20x`)
  - `display.showConfigCounts`: → **`true`** (`N CLAUDE.md | N MCPs | N hooks`)
  - `display.usageOnNewLine`: → **`true`** (usage/weekly on their own second row)
  - `display.timeFormat`: `relative` → **`absolute`** (`resets at 11:00 PM`)
  - `colors.usage`/`colors.usageWarning`: `brightBlue`/`brightMagenta` → **`green`/`yellow`** (usage bars follow the green→yellow→red threshold scheme)
- **Existing `config.json` files still override everything** — no custom setup changes. This only affects config-less/fresh installs.

## [0.3.3] - 2026-07-17

### Added
- **`display.usageOnNewLine`** (compact layout, default off): renders the usage/weekly windows on their own deterministic second row instead of inline. Row 1 keeps identity / context / project / config-counts / duration; row 2 starts with the usage windows. (Replaces the pre-0.5.1 behavior that was lost in the upstream rebase; previously the single compact line just wrapped at an arbitrary width boundary.)
- **`display.authShortLabel`** (default off): strips the leading `Claude ` from the auth/plan label — `Claude Max 20x` → `Max 20x`. Composes with `showAuthInModel` for a compact `[Opus 4.8 | Max 20x]` bracket.

## [0.3.2] - 2026-07-17

### Added
- **`display.showAuthInModel`** (default off): folds the auth/plan label into the model bracket — `[Opus 4.8 | Claude Max 20x]` — instead of trailing it as its own segment. The trailing segment is suppressed while this is on, so the label renders exactly once. `showAuth` / `showAuthUser` still control whether the label exists at all. Works in both compact and expanded layouts.

## [0.3.1] - 2026-07-17

### Fixed
- **Setup Step 4 no longer contradicts the enhanced defaults**: the optional-features prompt used to claim tools/agents/todos/duration were "hidden by default" and offered to enable them, but those default to **on** in `claude-hud-enhanced`. Step 4 now offers a "Minimal mode" to turn them off (plus config-counts / session-name / custom-line extras) and points to `/claude-hud-enhanced:configure` for deeper tuning.
- **Legacy `statusline.mjs` is no longer seeded into the enhanced data dir** during migration (runtime and setup): the old launcher globs the `claude-hud` plugin path, so copying it installed a wrong-name launcher. Setup regenerates it fresh under the enhanced path instead. Added a regression test.
- **Cross-device (EXDEV) migration now completes the move**: when `rename` fails and the dir is copied, the legacy dir is now removed, so later statusline paints don't repeatedly re-enter the "both dirs exist" seeding branch.

## [0.3.0] - 2026-07-17

### Changed
- Rebase plugin on upstream [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) **v0.5.1** (auth, effort, external usage, skills/MCP line, expanded config surface, i18n zh-Hans/zh-Hant).
- Identity remains **claude-hud-enhanced** (package, marketplace, plugin manifest); HUD data dir is `~/.claude/plugins/claude-hud-enhanced/` (config, caches, statusline launcher) — not the upstream `claude-hud` path.
- Auto-migrate on first run / setup: rename `plugins/claude-hud` → `plugins/claude-hud-enhanced` when the enhanced path is missing; if both exist, copy missing `config.json` (never overwrite).
- Plan label: upstream `showAuth` replaces legacy `showPlan`/`oauth.ts`. Existing `display.showPlan` configs migrate to `showAuth`.
- Enhanced defaults vs stock upstream: separators on, tools/agents/todos/auth visible, duration/output-style on, context value `both`, git ahead-behind + file stats on, `sevenDayThreshold: 0` (weekly usage always visible when data exists). (`lineLayout` stays upstream `expanded` so added-dirs and multi-line elements work.)

### Removed
- `src/oauth.ts` and keychain-based plan detection (superseded by upstream `auth.ts` reading Claude Code's oauth account profile).


All notable changes to Claude HUD will be documented in this file.

## [0.2.38] - 2026-06-23

### Fixed
- **Plan/tier label leaked across config-dir profiles**: The OAuth plan cache directory and the keychain service-name fallback both ignored `CLAUDE_CONFIG_DIR`, so a non-default profile (e.g. a separate work profile run via `CLAUDE_CONFIG_DIR=~/.claude-work`) displayed the default/personal account's subscription tier — and vice-versa. `getCacheDir()` now scopes the cache to the active config dir via `getHudPluginDir()`, and `getKeychainServiceNames()` no longer falls back to the personal `Claude Code-credentials` service for non-default profiles. Each profile now reads only its own account's plan/usage. Added `tests/oauth.test.js` covering both behaviors.

## [0.2.37] - 2026-05-09

### Fixed
- **Faster plan-label recovery after `/login` on macOS/Windows**: When the OAuth cache held a `null` subscription (e.g. after an external sync wrote a stripped credential, or right after a fresh login on a system without `.credentials.json`), the keychain-only TTL of 60s left the plan chip blank for up to a minute. The cache now uses a 10-second TTL specifically when `subscriptionType` is `null`, so a repaired keychain reflects in the HUD almost immediately. A real, populated subscription still uses the normal 60s/5min TTLs.

## [0.2.36] - 2026-05-05

### Improved
- **Cross-platform plan switch detection**: Reduced cache TTL from 5 minutes to 60 seconds for keychain-only systems (macOS/Windows without `.credentials.json`). File-based credential systems (Linux) still get instant invalidation via mtime tracking. Ensures plan label updates within 1 minute on all platforms.

## [0.2.35] - 2026-04-29

### Fixed
- **Plan label not updating on plan switch**: OAuth cache used a 5-minute TTL with no file-change detection, so switching plans (e.g. Pro → Max) left the old plan name displayed for up to 5 minutes. Now tracks `~/.claude/.credentials.json` mtime in the cache and invalidates immediately when the file changes. Added explicit guard for old cache format upgrade path.

## [0.2.33] - 2026-04-18

### Removed
- **Effort/thinking level display** — removed entirely. Claude Code does not expose effort level through stdin (7+ open GitHub issues requesting it), and `settings.json` is unreliable (the "max" and "xhigh" values aren't serialized due to a Claude Code bug). Removed: `detectSessionEffort()`, `effortDisplay()`, `showThinkingLevel` config, `effortLevel` from `ConfigCounts`, and all related code/tests. Will re-add when Anthropic ships an `effort` field in the statusline stdin contract.

## [0.2.32] - 2026-04-18

### Fixed
- CI failure on Node 20/Linux: Added `detectSessionEffort: () => undefined` mock to all 9 partial `MainDeps` test stubs in `index.test.js`. The real `detectSessionEffort` reads `/proc/{ppid}/cmdline` which behaves differently on CI runners vs local dev.
- Windows session effort detection: Added `Get-CimInstance Win32_Process` PowerShell fallback for reading parent process command line.

## [0.2.31] - 2026-04-18

### Improved (via Codex + Claude collab)
- **Auto-versioned config cache**: Replaced manual `CONFIG_CACHE_VERSION` number with TypeScript-enforced `CONFIG_COUNTS_SHAPE` mapped type. Adding a field to `ConfigCounts` without updating the shape object causes a build error, and the derived cache key changes automatically — no manual bump needed.
- **Session-level effort detection**: New `detectSessionEffort()` reads the parent Claude Code process args via `/proc/{ppid}/cmdline` (Linux) or `ps -o args=` (macOS) to detect `--effort` flag overrides. Session effort takes priority over the persistent `settings.json` value.
- **Visual effort display**: Effort level now renders with a color-coded gear icon outside the model brackets: `[Opus 4.7 | Max 5x] ⚙ high`. Colors: green for high, yellow for medium, red for low.

## [0.2.30] - 2026-04-18

### Fixed
- **Config cache versioning**: Added `CONFIG_CACHE_VERSION` stamp to the config-reader cache format. Plugin upgrades that change `ConfigCounts` shape (like adding `effortLevel`) now automatically invalidate stale cache files from older versions. Previously, a cached result from an older plugin could be returned with missing fields because the sentinel only checked file mtime, not cache format compatibility.

## [0.2.29] - 2026-04-18

### Fixed
- Read `effortLevel` from the full settings cascade: `~/.claude/settings.json` → `settings.local.json` → `./.claude/settings.json` (project) → `./.claude/settings.local.json` (project local). Each layer overrides the previous.

## [0.2.28] - 2026-04-18

### Added
- Show thinking/effort level (`high`, `medium`, `low`) next to model and plan: `[Opus 4.7 (1M context) | Max 5x | high]`. Reads `effortLevel` from `~/.claude/settings.json`. New `display.showThinkingLevel` toggle (default `true`).

## [0.2.27] - 2026-04-18

### Changed
- `display.usageOnNewLine` default flipped back to `true`. Usage/Weekly renders on its own second row with a blank-line spacer by default on all platforms. Set `usageOnNewLine: false` to inline it back on the main row.

## [0.2.26] - 2026-04-18

### Changed
- `lineLayout` default flipped from `'expanded'` to `'compact'`. All platforms (Windows, Linux, macOS) now show the clean single-line session row by default. Set `lineLayout: 'expanded'` to restore the multi-row layout.

## [0.2.25] - 2026-04-17

### Changed
- `display.contextValue` default flipped from `'percent'` to `'both'`. The context bar now shows `29% (200k/1.0M)` out of the box instead of just `29%`. Set `contextValue: 'percent'` to get the old percentage-only display, or `'tokens'` / `'remaining'` for the other modes.

## [0.2.24] - 2026-04-17

### Changed
- When `display.usageOnNewLine: true` is set, insert a blank line between the main session row and the Usage/Weekly row so the two rows are visually separated.

## [0.2.23] - 2026-04-17

### Changed
- `display.usageOnNewLine` default flipped back to `false`. The compact layout renders Usage/Weekly inline on the main row by default; set `usageOnNewLine: true` to opt into the two-row layout introduced in 0.2.22.

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
