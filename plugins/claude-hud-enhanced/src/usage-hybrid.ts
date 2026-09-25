import type { ScopedUsageWindow, UsageData } from './types.js';
import { parseScopedWindows } from './stdin.js';
import {
  type SnapshotFsDeps,
  type UsageSnapshot,
  defaultSnapshotFs,
  getLockPath,
  getSnapshotPath,
  readSnapshot,
  writeSnapshotAtomic,
} from './usage-snapshot.js';

/**
 * ccstatusline-style hybrid usage resolution.
 *
 *   - While CHATTING: Claude Code hands fresh `rate_limits` on stdin. stdin is
 *     authoritative; we persist it to the snapshot (which also resets the idle TTL
 *     clock, so the refresher never fires during active use).
 *   - While IDLE: Claude Code keeps re-sending the last-known FROZEN rate_limits on
 *     every render (stdin usage is essentially never null mid-session). Idle is
 *     therefore detected as "stdin stopped advancing", not "stdin disappeared":
 *     frozen stdin doesn't rewrite the snapshot, so `updated_at` ages, and once it
 *     is past the TTL (and not in backoff) we spawn the detached OAuth refresher
 *     (refresh-usage.js) to pull the live account-wide number (e.g. usage burned on
 *     another device). Rendering never blocks on the network.
 *
 * Monotonic newer-detection: rate-limit data only moves one way within a window
 * (resets_at advances, utilization rises), so "is stdin newer than the snapshot?"
 * is decidable from the two values alone — a stale stdin from a second idle session
 * can never clobber a fresher OAuth snapshot.
 */
/** Idle gate: how long the snapshot may sit unwritten before we refresh it. */
export const USAGE_TTL_MS = 60_000;
/**
 * Active gate: how stale the last LIVE read may get while the user is chatting.
 * stdin re-stamps `updated_at` on every message, so the idle gate alone can never
 * fire mid-conversation — and usage burned in another terminal, on another
 * machine, or on claude.ai would stay invisible until the session went quiet.
 */
export const OAUTH_MAX_AGE_MS = 120_000;
export const LOCK_STALE_MS = 60_000; // a refresher lock older than this is abandoned
// Refresher backoff policy lives HERE, next to the gates it must comfortably
// exceed: if a backoff dropped below a spawn gate, a failing refresher would
// be respawned on nearly every stale render — the retry-storm shape this
// feature exists to prevent (ccstatusline #204). tests/usage-hybrid.test.js
// asserts the margin so a future gate cut cannot quietly erase it.
/**
 * Auth failures retry on the error cadence, not a long one: the usual cure is
 * the user signing in again, and a 30-minute wait kept the HUD stale for up to
 * half an hour after a successful /login. A failed read costs one local Keychain
 * lookup (plus one 401 when a token was found), which is cheap at this rate.
 */
export const BACKOFF_AUTH_MS = 5 * 60_000;
export const BACKOFF_ERROR_MS = 5 * 60_000;
/**
 * 429 fallback when the server sent no Retry-After. Its own constant rather than
 * a multiple of USAGE_TTL_MS, so cutting the TTL cannot silently shorten the one
 * backoff a server explicitly asked for.
 */
export const BACKOFF_RATE_LIMIT_MS = 6 * 60_000;
/**
 * How long a snapshot may go unconfirmed, while its OAuth poll is failing, before
 * the HUD flags the numbers as stale. Without this a poll that broke (an expired
 * token, a network outage) kept rendering the last good reading as if it were
 * live: one profile showed "Weekly 92%" for 33 hours while Claude Code was
 * refusing requests because the weekly limit had been hit.
 */
export const USAGE_STALE_MS = 15 * 60_000;

function toMs(d: Date | null | undefined): number | null {
  return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null;
}

function parseMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** ISO string for a valid Date, null otherwise (an Invalid Date would throw). */
function isoOrNull(d: Date | null | undefined): string | null {
  return d instanceof Date && Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Compare one window (A vs B). Returns >0 if A is newer, <0 if B is newer, 0 if
 * equal or undecidable. Later reset = newer window; within the same window a higher
 * utilization is newer.
 */
function windowCompare(
  aReset: number | null,
  aPct: number | null,
  bReset: number | null,
  bPct: number | null,
): number {
  if (aReset != null && bReset != null) {
    if (aReset !== bReset) return aReset - bReset;
    if (aPct != null && bPct != null && aPct !== bPct) return aPct - bPct;
    return 0;
  }
  return 0;
}

/** +1 if stdin is newer than the snapshot, -1 if the snapshot is newer, 0 if equal. */
export function compareStdinSnapshot(stdin: UsageData, snap: UsageSnapshot): number {
  const five = windowCompare(
    toMs(stdin.fiveHourResetAt),
    stdin.fiveHour,
    parseMs(snap.five_hour.resets_at),
    snap.five_hour.used_percentage,
  );
  if (five !== 0) return Math.sign(five);
  const seven = windowCompare(
    toMs(stdin.sevenDayResetAt),
    stdin.sevenDay,
    parseMs(snap.seven_day.resets_at),
    snap.seven_day.used_percentage,
  );
  return Math.sign(seven);
}

/** True when stdin is strictly newer than the snapshot (write-back decision). */
export function isStrictlyNewer(stdin: UsageData, snap: UsageSnapshot): boolean {
  return compareStdinSnapshot(stdin, snap) > 0;
}

/** The snapshot's model-scoped windows (e.g. Fable), or null when it has none. */
function snapshotScopedWindows(snap: UsageSnapshot): ScopedUsageWindow[] | null {
  const windows = parseScopedWindows(snap.model_scoped);
  return windows.length > 0 ? windows : null;
}

/** Snapshot → UsageData: the 5h/7d windows plus any model-scoped ones. */
export function snapshotToUsage(snap: UsageSnapshot): UsageData {
  const fiveReset = parseMs(snap.five_hour.resets_at);
  const sevenReset = parseMs(snap.seven_day.resets_at);
  const scoped = snapshotScopedWindows(snap);
  return {
    fiveHour: snap.five_hour.used_percentage,
    sevenDay: snap.seven_day.used_percentage,
    fiveHourResetAt: fiveReset != null ? new Date(fiveReset) : null,
    sevenDayResetAt: sevenReset != null ? new Date(sevenReset) : null,
    ...(scoped != null && { scopedWindows: scoped }),
  };
}

/**
 * Serve the snapshot's windows while keeping the stdin extras the snapshot lacks
 * (model-scoped windows it has none of, the balance label), so a newer snapshot
 * never makes the Fable weekly bar or balance segment vanish.
 */
export function snapshotOverStdin(snap: UsageSnapshot, stdinUsage: UsageData): UsageData {
  const usage = snapshotToUsage(snap);
  return {
    ...usage,
    ...(usage.scopedWindows == null && stdinUsage.scopedWindows != null && { scopedWindows: stdinUsage.scopedWindows }),
    ...(stdinUsage.balanceLabel != null && { balanceLabel: stdinUsage.balanceLabel }),
  };
}

/**
 * Fill in the snapshot's model-scoped windows when `usage` carries none of its
 * own. Claude Code has not been forwarding `rate_limits.model_scoped` on stdin
 * (see index.ts), so without this the Fable window the OAuth poll found would
 * disappear the moment a live stdin reading won the comparison.
 */
function withSnapshotScoped(usage: UsageData, snap: UsageSnapshot): UsageData {
  if (usage.scopedWindows != null) return usage;
  const scoped = snapshotScopedWindows(snap);
  return scoped != null ? { ...usage, scopedWindows: scoped } : usage;
}

/**
 * UsageData → snapshot. `source` marks who wrote it. Refresher-owned fields
 * (`oauth_updated_at`, `status`, `next_attempt_at`) are carried verbatim from the
 * previous snapshot so a stdin write never clears an in-flight backoff the poller
 * set, nor forges a LIVE read that never happened.
 */
export function usageToSnapshot(
  usage: UsageData,
  source: UsageSnapshot['source'],
  now: number,
  prev: UsageSnapshot | null,
): UsageSnapshot {
  // stdin's own scoped windows when it has them; otherwise keep the poll's, so a
  // stdin write never erases the Fable window only the OAuth poll can see.
  const modelScoped = usage.scopedWindows != null
    ? usage.scopedWindows.map((w) => ({
        display_name: w.label,
        utilization: w.percent,
        resets_at: isoOrNull(w.resetAt),
      }))
    : prev?.model_scoped;
  return {
    updated_at: new Date(now).toISOString(),
    // Carried, never stamped: only a real OAuth read may move this clock. Resetting
    // it here would make every active render look never-polled and spawn again.
    oauth_updated_at: prev?.oauth_updated_at ?? null,
    source,
    five_hour: {
      used_percentage: usage.fiveHour,
      resets_at: isoOrNull(usage.fiveHourResetAt),
    },
    seven_day: {
      used_percentage: usage.sevenDay,
      resets_at: isoOrNull(usage.sevenDayResetAt),
    },
    ...(modelScoped !== undefined && { model_scoped: modelScoped }),
    status: prev?.status ?? 'ok',
    next_attempt_at: prev?.next_attempt_at ?? null,
  };
}

/**
 * When the snapshot's numbers can no longer be presented as current, the time they
 * were last confirmed (by a stdin advance or a successful OAuth read); null while
 * they are fresh. Only a FAILING poll makes a snapshot stale: with a working one
 * the refresher replaces an aged snapshot within seconds, and flagging it in that
 * gap would flicker a warning after every laptop wake.
 */
export function snapshotStaleSince(snap: UsageSnapshot, now: number): Date | null {
  if (snap.status === 'ok') return null;
  const confirmedAt = parseMs(snap.updated_at) ?? 0;
  return now - confirmedAt > USAGE_STALE_MS ? new Date(confirmedAt) : null;
}

/**
 * The single decision point for "should a refresher run now?", shared by the parent
 * (resolveUsage, which spawns) and the child (refresh-usage, which re-checks before
 * spending a request). Keeping it in ONE place is load-bearing: if the parent
 * spawned on a condition the child did not honour, the child would no-op, release
 * the lock, and be respawned on the very next render — a spawn storm wearing the
 * costume of a working single-flight.
 *
 * Unparseable timestamps read as infinitely stale, never as fresh: a corrupt clock
 * should cost one refresh, not freeze the display at a stale number forever.
 */
export function shouldRefresh(snap: UsageSnapshot, now: number): boolean {
  // Backoff outranks both gates — it is the storm guard itself.
  const nextAttempt = parseMs(snap.next_attempt_at);
  if (nextAttempt != null && nextAttempt > now) return false;

  const age = now - (parseMs(snap.updated_at) ?? 0);
  if (age > USAGE_TTL_MS) return true; // idle: nobody has written in a while

  const oauthAt = parseMs(snap.oauth_updated_at);
  return oauthAt == null || now - oauthAt > OAUTH_MAX_AGE_MS; // active: stale LIVE read
}

/**
 * Try to claim the single-flight refresher lock. Cleans up a stale lock (older than
 * LOCK_STALE_MS) left by a crashed refresher, then creates the lock with `wx` so only
 * one caller wins the race. Returns true iff this caller now holds the lock.
 */
export function tryTakeLock(lockPath: string, now: number, deps: SnapshotFsDeps): boolean {
  try {
    if (deps.existsSync(lockPath)) {
      try {
        const st = deps.statSync(lockPath);
        if (now - st.mtimeMs < LOCK_STALE_MS) return false; // a fresh lock is held
      } catch {
        /* stat failed — fall through and try to re-take */
      }
      // Atomic stale reclaim via rename: of N racers, exactly ONE rename can
      // succeed (the rest get ENOENT), so a racer can never delete a lock
      // another racer just created. The previous rm-based reclaim had a TOCTOU
      // where every post-sleep terminal could "win" and spawn its own OAuth
      // refresher — an N-way burst violating the single-flight guarantee.
      const stalePath = `${lockPath}.stale.${process.pid}.${now}`;
      try {
        deps.renameSync(lockPath, stalePath);
      } catch {
        return false; // another racer reclaimed it first
      }
      try {
        deps.rmSync(stalePath, { force: true });
      } catch {
        /* best effort */
      }
    }
    deps.writeFileSync(lockPath, String(process.pid), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    return true;
  } catch {
    return false;
  }
}

export interface HybridDeps {
  now: () => number;
  homeDir: string;
  fs: SnapshotFsDeps;
  /** Launch the detached OAuth refresher for this profile. Must never throw/block. */
  spawnRefresher: (homeDir: string) => void;
  /**
   * Whether spawning the refresher can accomplish anything (e.g. its script is
   * installed). When false, skip the lock entirely so idle sessions don't churn
   * lock files for a spawn that would no-op. Absent = assume it can.
   */
  canRefresh?: () => boolean;
}

/**
 * Resolve the usage to render, blending live stdin with the persisted snapshot.
 * Never blocks: any OAuth refresh happens in a detached child, and this call only
 * ever reads/writes local files.
 */
export function resolveUsage(
  stdinUsage: UsageData | null,
  enabled: boolean,
  deps: HybridDeps,
): UsageData | null {
  if (!enabled) return stdinUsage;

  const snapshotPath = getSnapshotPath(deps.homeDir);
  const lockPath = getLockPath(deps.homeDir);
  const snap = readSnapshot(snapshotPath, deps.fs);
  const now = deps.now();

  // Spawn the detached refresher iff shouldRefresh() says so, or when there is no
  // snapshot at all to judge. Throttled by the single-flight lock; never blocks or throws.
  const maybeRefresh = (s: UsageSnapshot | null): void => {
    if (deps.canRefresh?.() === false) return; // refresher not installed — no lock churn
    if ((s == null || shouldRefresh(s, now)) && tryTakeLock(lockPath, now, deps.fs)) {
      try {
        deps.spawnRefresher(deps.homeDir);
      } catch {
        /* never let a spawn failure break the render */
      }
    }
  };

  if (stdinUsage != null) {
    // stdin present (fresh OR frozen — Claude Code re-sends the last values while
    // idle). Serve the snapshot only if it is strictly newer than stdin (OAuth
    // caught other-device usage stdin hasn't seen yet); otherwise stdin wins.
    const cmp = snap ? compareStdinSnapshot(stdinUsage, snap) : 1;
    if (snap == null || cmp > 0) {
      // stdin advanced → user is active. Persist it, which stamps updated_at and
      // resets the idle gate. The LIVE clock is carried through untouched, so a
      // long conversation still refreshes account-wide usage on its own cadence
      // instead of going blind to every other terminal until it falls quiet.
      const written = usageToSnapshot(stdinUsage, 'stdin', now, snap);
      writeSnapshotAtomic(snapshotPath, written, now, deps.fs);
      maybeRefresh(written);
      return withSnapshotScoped(stdinUsage, written);
    }
    // stdin did NOT advance (cmp <= 0) → frozen stdin, i.e. idle. The snapshot's
    // updated_at keeps aging, so refresh when it goes stale. When the snapshot is
    // strictly newer (another terminal/device advanced it), serve its windows while
    // keeping stdin-only extras (scoped windows, balance label). Either way nothing
    // newer than the snapshot has been seen, so its age is the age of these numbers.
    maybeRefresh(snap);
    const served = cmp < 0 ? snapshotOverStdin(snap, stdinUsage) : withSnapshotScoped(stdinUsage, snap);
    return withStaleness(served, snap, now);
  }

  // No stdin usage at all this render (e.g. rate_limits absent). Serve the
  // snapshot and refresh it when stale. With no snapshot either, the poll is the
  // only way a number can ever appear, so start it: returning early here left an
  // account whose stdin never carries rate_limits without usage forever.
  maybeRefresh(snap);
  if (snap == null) return null;
  return withStaleness(snapshotToUsage(snap), snap, now);
}

/** Tag `usage` with the snapshot's staleness; returns it unchanged while fresh. */
function withStaleness(usage: UsageData, snap: UsageSnapshot, now: number): UsageData {
  const staleSince = snapshotStaleSince(snap, now);
  return staleSince ? { ...usage, staleSince } : usage;
}

export { defaultSnapshotFs };
