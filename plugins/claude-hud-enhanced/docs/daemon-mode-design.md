# Warm Daemon Mode — Design (Issue #6)

Design produced by the daemon-research agent (2026-07-19), grounded in the
current source: `src/index.ts` (`main()`/`MainDeps`), `src/git-cache.ts`,
`src/usage-hybrid.ts` + `src/usage-snapshot.ts`, `src/utils/cache-file.ts`,
`src/claude-config-dir.ts`, `src/config.ts`, `src/render/index.ts`,
`commands/setup.md`, `CHANGELOG.md` 0.4.9–0.4.13. Phase 1 implemented from
this document; implementation deviations are recorded in the addendum at the
bottom.

## 0. Invocation model

Claude Code does **not** invoke the statusline on a fixed ~300ms poll. Per
CHANGELOG 0.4.9: it fires on conversation events (new assistant message,
`/compact`, permission-mode/vim-mode change; debounced 300ms) **and** on a
`statusLine.refreshInterval` timer while idle, which setup benchmarks the
machine to pick from **2s / 5s / 10s tiers** (Windows gets a hard floor of
5s). Apple Silicon + bun renders ~50-90ms warm; older Intel/node 150–500ms;
slow-spawn hardware (Windows especially) >500ms and lands on the 10s tier.
The daemon's entire payoff is that last tier.

On macOS/Linux the per-repaint command is a `bash -c` wrapper that re-globs
the plugin cache for the latest installed version on every invocation, then
`exec`s either `bun src/index.ts` (bun preferred) or `node dist/index.js`.
Windows always uses node + a pre-generated `statusline.mjs` launcher.

## 1. Process model

**The daemon is the same entry point, not a second binary.** `--daemon` is a
mode of the same file `main()` lives in, dispatched from the bottom-of-file
entry guard before the normal `main()` call.

**Spawn:** fire-and-forget from the client's failed-connect path (§7), via
`spawn(process.execPath, [...process.execArgv, entryPath, '--daemon'],
{ detached: true, stdio: 'ignore', windowsHide: true, env: process.env })` +
`unref()` — the same pattern `spawnUsageRefresher` uses.

**Decision — re-exec with `process.execPath`/`execArgv`, not hardcoded
`node dist/...`:** setup's runtime detection means a user can have only bun
and no node on PATH. Re-execing with whatever runtime rendered the invocation
that decided to spawn guarantees the daemon runs under a runtime that is
provably present.

**Survive/exit:** deliberately detached, NOT tied to Claude Code's lifetime
(other terminals on the profile reuse it). Exits on: (a) idle timeout,
(b) version mismatch (serves the request, then exits), (c) uncaught exception
(best-effort cleanup, then exit). The pid file (`daemon/hud.pid`) is advisory
only — correctness only ever depends on the socket connect attempt.

## 2. IPC

- **macOS/Linux:** Unix domain socket at
  `{getHudPluginDir(homeDir)}/daemon/hud.sock`. `getHudPluginDir` already
  resolves inside the profile's own `CLAUDE_CONFIG_DIR` tree, so per-profile
  isolation needs no hashing. Directory 0700; socket chmod 0600 after
  `listen()`.
- **Windows (phase 2):** named pipe
  `\\.\pipe\claude-hud-enhanced-{sha256(resolvedConfigDir).slice(0,16)}`.
  Pipe names live in a flat machine-global namespace, so per-profile
  uniqueness genuinely requires hashing there. The asymmetry (no hash on
  Unix, hash on Windows) is real, not an inconsistency.
- One `getIpcPath(homeDir)` helper branches on `process.platform`; Node's
  `net` module accepts both transparently.

**Protocol — newline-delimited JSON.** One `JSON.stringify(obj) + '\n'` per
message per direction. Safe framing by construction: `JSON.stringify`
escapes literal newlines inside strings, so splitting the byte stream on
`\n` is unambiguous. Payloads are far too small for length-prefixing to earn
its complexity.

- **Request:** `{ v: 1, pluginVersion, stdin: StdinData (already parsed),
  cwd, env: { COLUMNS?, DEBUG?, CLAUDE_CONFIG_DIR? }, now }`.
- **Response:** `{ v: 1, pluginVersion, output: string | null, willExit }`.

**Client budgets — connect ~50ms, response ~500ms.** Same-host socket
connects are sub-millisecond, so 50ms only trips on a hung daemon and stays
under the fastest refresh tier. 500ms ≈ the slow-cold-start render itself —
if a warm daemon can't beat that, connecting bought nothing; timing out and
falling back means the daemon path is provably never worse than inline.
**Any** failure → render inline (the unmodified, already-tested current
path) AND fire-and-forget spawn/respawn for the next tick.

**Decision — sequential try-then-fallback, not racing daemon-vs-inline:**
inline execution has real side effects (cache writes, refresher spawns) that
would already have happened by the time a losing racer was cancelled.

## 3. Daemon internals — reuse `main()`, don't duplicate it

`MainDeps` already makes `readStdin`, `render`, and `log` injectable. The
daemon builds fresh `MainDeps` per request: `readStdin` returns the
request's already-parsed stdin; `render` captures output instead of
printing.

**`render()` output seam:** `render(ctx)` printed via `console.log`
directly. Rather than monkeypatching console (an invisible synchronicity
invariant), add an optional writer parameter defaulting to `console.log` —
zero behavior change for existing callers; the daemon passes a capturing
closure.

**Config-load reordering:** deciding "try the daemon?" needs
`config.daemon.enabled`, so `loadConfig()` moves ahead of the daemon-or-not
branch; the 0.4.13 `Promise.all` becomes two-way (transcript + config
counts). A mechanical reordering, not a reversal, of that optimization.

**Warm state:** git-status and config-count caches re-validated against
their files (an inline fallback process's write must never be shadowed).
Transcript parsing is where a warm daemon pays off most — scoped as a
future slot for issue #1's incremental parser, not built here.
**Usage data is explicitly NOT kept warm in-memory** (§6).

**Idle self-exit: 10 minutes**, reset on every served request. ~60–300× the
longest refresh tier, still bounded within a work session. A judgment call
with no external anchor — flagged as such.

## 4. Multi-session / multi-profile

One daemon per **profile** (resolved `CLAUDE_CONFIG_DIR`). Multiple
terminals/sessions on one profile share one daemon; a custom work profile
gets an independent daemon/socket/timer. Per-transcript/per-repo state keys
by transcript path / git dir, not session id.

## 5. Upgrades & staleness

Client sends its plugin version (this package's `package.json` — distinct
from `version.ts`, which resolves the `claude` CLI's version). On mismatch
the daemon serves the current request correctly, then exits after
responding. The next tick's client hits a closed socket, cleans up, and
respawns from whatever version its launcher resolved (setup's version-glob
re-resolves every invocation). Crash-exit, idle-exit, and mismatch-exit all
funnel into the same client-side "connect failed → inline → spawn" path.

## 6. Preserving the OAuth single-flight exactly

The daemon calls `resolveUsage()`/`tryTakeLock()`/`readSnapshot()`/
`writeSnapshotAtomic()` **unchanged** — no in-memory shortcut for usage.
The ~1-request/3-min ceiling is a hard external constraint, and the file
lock is what is visible to every process that must respect it: inline
fallback processes and other profiles' daemons share nothing else. An
in-memory guard would protect this daemon only against itself.

## 7. Failure containment

- **Crash mid-request:** per-request try/catch → close connection → client
  sees no response → inline fallback. Top-level `uncaughtException` →
  best-effort socket/pid cleanup → exit(1).
- **Hangs:** covered by the client's 500ms response budget. No cross-process
  kill logic — a hung daemon costs each client its budget until idle-timeout
  or a version bump cycles it. **Accepted limitation, named.**
- **Stale socket:** connect `ECONNREFUSED`/`ENOENT` → best-effort unlink
  (idempotent under racing clients) → attempt spawn. Do NOT unlink on a
  response timeout (the daemon may be alive but slow).
- **Spawn single-flight:** dedicated `daemon/hud.spawn.lock` held only for
  the duration of `spawn()` itself, reusing `tryTakeLock`'s atomic
  rename-steal verbatim (hardened against this TOCTOU shape in 0.4.12).
  Losers fall back inline this tick and find the daemon next tick.

## 8. CLI surface

None beyond the internal `--daemon` flag. No start/stop/status/doctor —
the config flag is the entire user-facing surface; `DEBUG` logging via the
existing `createDebug` pattern is the only observability. Deliberate scope
cut for a V1 whose premise is "must never make things worse than today."

## Config schema

`HudConfig.daemon: { enabled: boolean }`, default **off**, mirroring
`gitStatus`'s nested-object convention (same 4 touch points in config.ts).

## Risks

| Risk | Mitigation / accepted limitation |
|---|---|
| Windows named pipe lifetime | No stale file to clean (pipes vanish with the process); same connect-fail path; **untested until phase 2 on real Windows**. |
| Orphaned daemons across logout | Detached processes die with the OS session; pid file is advisory-only. `sweepCacheDir` over `daemon/` is a cheap follow-up. |
| bun-vs-node | Solved by re-exec with `process.execPath`/`execArgv`. |
| Mixed plugin versions mid-upgrade | Serve-then-exit per mismatch; worst case is exit+respawn churn with no speedup and no corruption until repaints converge. Self-heals. |
| Spawn-lock stale-reclaim race | Same atomic-rename-steal discipline as `tryTakeLock` (0.4.12). |

## Effort / phases

~600–900 new lines (`daemon.ts`, `daemon-client.ts`, `daemon-ipc.ts`) +
~50-line diff across `index.ts`/`render/index.ts`/`config.ts` + 3 test
files (real sockets against tmp dirs; injectable clock for idle timeout).

**Phase 1 (this implementation): Unix-only, opt-in, default off.**
De-risks the novel parts (protocol, handshake, spawn single-flight) on the
fast-feedback platform. **Phase 2: Windows named pipe** + `statusline.mjs`
launcher update + real Windows validation — Windows is the actual payoff
hardware, sequenced second deliberately.

---

## Phase-1 implementation addendum (deviations from the design)

1. **Requests are serialized (queued), not handled concurrently.** The
   design assumed all per-request state was request-scoped, but terminal
   width (`COLUMNS`) reaches `render` via mutable process-global env, and
   `main()` awaits between env application and render. Serializing requests
   (they cost ~5–15ms warm against 1–5s ticks) removes the interleaving
   hazard entirely; revisit only if latency ever matters.
2. **Per-request `DEBUG` is not honored** — `createDebug` instances bind at
   module load; the daemon logs under its spawn-time `DEBUG` only.
3. **In-memory warm mirrors of git/config caches are deferred.** Phase 1's
   win is eliminating process startup (the dominant cost); the file caches
   are already cheap. The mirrors can come with issue #1's incremental
   parser.
4. **The spawn lock is NOT released after `spawn()`** (design said
   "held only for the duration of the spawn call"). Racing clients are
   separate processes whose critical sections don't overlap — an immediate
   release lets each sequential racer take the lock fresh and spawn its own
   daemon (caught by the client race test). Leaving the lock to expire via
   the 60s staleness reclaim caps spawning at one attempt per stale window,
   which is the actual requirement; extra daemons are harmless
   (EADDRINUSE → exit) but wasteful.
5. **Unix socket paths >100 chars fall back to a hashed name under the OS
   temp dir** — `bind()` fails EINVAL past the ~104-byte `sun_path` limit
   (deep `CLAUDE_CONFIG_DIR`s, long home paths; found by the client tests).
   The fallback socket is 0600; a squatter on the predictable /tmp name only
   degrades that profile to inline mode, never breaks the HUD.
