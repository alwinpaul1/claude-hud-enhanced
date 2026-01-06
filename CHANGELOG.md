# Changelog

All notable changes to Claude HUD will be documented in this file.

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
