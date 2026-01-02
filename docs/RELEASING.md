# Releasing Claude HUD

## Versioning Strategy

Claude HUD follows semantic versioning. Release tags are `vX.Y.Z`. Both
`tui/package.json` and `.claude-plugin/plugin.json` are kept in sync.

## Release Steps

1. Bump versions:
   ```bash
   node scripts/release.ts --bump patch
   ```
2. Generate changelog entry:
   ```bash
   node scripts/changelog.ts X.Y.Z
   ```
3. Review `docs/CHANGELOG.md`, commit, and tag:
   ```bash
   git commit -am "chore: release X.Y.Z"
   git tag vX.Y.Z
   git push --follow-tags
   ```

## Artifacts

GitHub Actions builds the TUI and uploads `claude-hud-tui.tar.gz` on release tags.
