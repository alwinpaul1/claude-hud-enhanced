# Changelog

All notable changes to Claude HUD will be documented in this file.

## [0.2.1] - 2026-04-17

### Changed
- **Default behavior**: the HUD now emits one logical line per rendered row and defers to the terminal's natural soft-wrap — matching the pre-sync horizontal look. The previous hard-split at ` | ` boundaries when a line exceeded terminal width is now opt-in via `display.wrapLines: true`.

### Added
- `display.wrapLines` config option (default `false`). Set to `true` to restore the 0.2.0 behavior of hard-splitting long lines at ` | ` boundaries when they exceed terminal width.

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
