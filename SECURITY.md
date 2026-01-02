# Security Policy

## Supported Versions

Security updates are provided for the latest release.

## Dependency Policy

- Run `bun run audit` from `tui/` before releases and during CI.
- Update `bun.lock` when dependency versions change; commits should include both
  `tui/package.json` and `tui/bun.lock`.

## Reporting a Vulnerability

Please report security issues privately. Use GitHub Security Advisories for this repository:

https://github.com/jarrodwatts/claude-hud/security/advisories

If you cannot use GitHub advisories, contact the maintainer via the GitHub profile:

https://github.com/jarrodwatts

## Threat Model (Summary)

The HUD reads local files (settings, CLAUDE.md, config) and parses hook event
payloads. Threats primarily involve untrusted local file contents or malformed
events. The HUD treats parsing errors as safe-mode conditions and falls back to
last known good state while logging errors. See `docs/THREAT_MODEL.md`.
