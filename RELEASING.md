# Releasing

This project ships as a Claude Code plugin. Releases should include compiled `dist/` output.

## Release Checklist

1) Update versions:
   - `package.json`
   - `.claude-plugin/plugin.json`
   - `CHANGELOG.md`
2) Build:
   ```bash
   npm ci
   npm run build
   npm test
   npm run test:coverage
   ```
3) Verify plugin entrypoint:
   - `.claude-plugin/plugin.json` points to `dist/index.js`
4) Commit and tag:
   - `git tag vX.Y.Z`
5) Publish:
   - Push tag
   - Create GitHub release with notes from `CHANGELOG.md`
