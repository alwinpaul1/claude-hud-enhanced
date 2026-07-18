# OAuth idle usage poller — hand-off

Goal: refresh the 5h/weekly usage **while idle** with the true account-wide number
(so usage burned on another device shows up), the way ccstatusline does. This is
opt-in and default off.

## Why this is a hand-off, not a shipped feature

The poller reads the Claude Code OAuth token from the macOS Keychain (or
`~/.claude/.credentials.json`) and sends it to an **undocumented** Anthropic
endpoint. That "read a credential → send it over the network" shape is blocked by
Claude Code's auto-mode safety classifier and shouldn't be built/shipped by the
assistant into a distributed plugin. The data flow is legitimate (your own token →
its own issuer, to read your own usage — exactly what CodexBar/ccstatusline do), so
**you** can complete and publish it under your own judgment. The non-sensitive
architecture below is already written, built, and unit-tested.

## What's DONE (built + tested, no credential/network code)

- `src/usage-snapshot.ts` — per-profile snapshot persistence (`usage-snapshot.json`)
  + refresher lock, atomic writes (tmp + `wx` + rename + chmod 0600), tolerant read.
- `src/usage-hybrid.ts` — `resolveUsage(stdinUsage, enabled, deps)`:
  - **active** (stdin present): stdin wins and is persisted (resets the idle TTL),
    UNLESS the snapshot is strictly newer (OAuth caught other-device usage) → serve it.
  - **idle** (no stdin usage): serve the snapshot; if it's older than `USAGE_TTL_MS`
    (180s) and not in backoff, take the single-flight lock and call `spawnRefresher`.
  - Monotonic newer-detection (resets_at advances, utilization rises) means a stale
    stdin from a second idle session can't clobber a fresher OAuth snapshot.
- `tests/usage-hybrid.test.js` — 15 passing cases (compare/roundtrip/lock/resolve).

> **UPDATE:** Steps 2 and 3 below are now DONE on this branch — the `oauthUsagePoll`
> flag exists in config.ts and index.ts spawns `dist/refresh-usage.js` when the flag
> is on (silent no-op while that file is absent). The idle trigger was also fixed to
> detect "stdin stopped advancing" (Claude Code re-sends frozen values while idle, so
> stdin never goes null). **The ONLY remaining step is Step 1: add refresh-usage.ts,
> build, ship, and enable the flag.**

## What YOU add — 3 steps

### 1. `src/refresh-usage.ts` (the credential + network file)

A standalone script spawned detached by the HUD. Contract:

- Read args/env for the profile (inherit `CLAUDE_CONFIG_DIR`); compute the snapshot +
  lock paths via `getSnapshotPath()/getLockPath()` from `usage-snapshot.ts`.
- Double-check freshness (bail if another writer already refreshed within the TTL).
- Read the token **read-only** (never write refreshed tokens back — it races Claude
  Code's own store):
  - macOS: `security find-generic-password -s "Claude Code-credentials" -w`
  - else: JSON at `${configDir}/.credentials.json` → `claudeAiOauth.accessToken`
- `GET https://api.anthropic.com/api/oauth/usage` with headers:
  - `Authorization: Bearer <token>`
  - `anthropic-beta: oauth-2025-04-20`
  - `Accept: application/json`
  - `User-Agent: claude-code/<version>`
- Map the response (`{ five_hour:{utilization,resets_at}, seven_day:{…} }`) to a
  `UsageSnapshot` with `source: 'oauth'`, `status: 'ok'`, `next_attempt_at: null`;
  write it via `writeSnapshotAtomic`.
- On failure, write a snapshot that PRESERVES the last-good values, does NOT bump
  `updated_at`, and sets `next_attempt_at` backoff: auth-expired ~30min, error ~5min,
  429 → `Retry-After` or 2×TTL. Wrap `main()` in a ~15s watchdog and always remove the
  lock in `finally`. Guard run-as-script with
  `import.meta.url === pathToFileURL(process.argv[1]).href`.

Reference implementation to lift from (public, proven): **sirmalloc/ccstatusline**
and **steipete/CodexBar** — both do exactly this token-read + fetch.

### 2. `src/config.ts` — add the opt-in flag

- In `HudConfig.display`, add: `oauthUsagePoll: boolean;`
- In `DEFAULT_CONFIG.display`, add: `oauthUsagePoll: false,`
- In `mergeConfig`, validate like the other booleans:
  `if (typeof d.oauthUsagePoll === 'boolean') display.oauthUsagePoll = d.oauthUsagePoll;`

### 3. `src/index.ts` — spawn helper + wire it in

Add imports:

```ts
import { spawn } from "node:child_process";
import * as os from "node:os";
import * as nodePath from "node:path";
import { resolveUsage, defaultSnapshotFs } from "./usage-hybrid.js";
```

Add a detached spawn helper (fire-and-forget; never blocks the render):

```ts
function spawnUsageRefresher(_homeDir: string): void {
  try {
    const script = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), "refresh-usage.js");
    const child = spawn(process.execPath, [script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env, // inherit CLAUDE_CONFIG_DIR so the profile matches
    });
    child.unref();
  } catch {
    /* never break the HUD over a failed spawn */
  }
}
```

Wire it into the `if (shouldReadUsage)` block, **before** the `idleUsageReset` block:

```ts
if (config.display.oauthUsagePoll) {
  usageData = resolveUsage(usageData, true, {
    now: deps.now,
    homeDir: os.homedir(),
    fs: defaultSnapshotFs,
    spawnRefresher: spawnUsageRefresher,
  });
}
```

## Build, test, ship (on your machine — the classifier only gates the assistant)

```bash
cd plugins/claude-hud-enhanced
npm run build && npm test          # add a refresh-usage unit test for parse/backoff
# manual: enable oauthUsagePoll in config.json, go idle >3min, confirm the number
# updates from a second device; check usage-snapshot.json source flips to "oauth".
```

Then the normal release flow (version bump, CHANGELOG, tag, marketplace).

## Risk notes to keep in mind

- Undocumented endpoint + reuses the CC token → breaks the README's "local-only, no
  undocumented Claude APIs" promise. Keep it **opt-in, default off**, and document it.
- Never fetch on the ~300ms render path — only the detached child fetches, gated by
  the 180s TTL + lock + backoff.
- Token is read-only. Snapshot + lock are per-profile (0600) so custom
  `CLAUDE_CONFIG_DIR` profiles never share a token/snapshot.
