import type { UsageData } from './types.js';
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
export const USAGE_TTL_MS = 180_000; // 3 min, matching ccstatusline's cache gate
export const LOCK_STALE_MS = 60_000; // a refresher lock older than this is abandoned

function toMs(d: Date | null | undefined): number | null {
  return d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null;
}

function parseMs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
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

/** Snapshot → UsageData. Note: snapshots only carry the 5h/7d windows. */
export function snapshotToUsage(snap: UsageSnapshot): UsageData {
  const fiveReset = parseMs(snap.five_hour.resets_at);
  const sevenReset = parseMs(snap.seven_day.resets_at);
  return {
    fiveHour: snap.five_hour.used_percentage,
    sevenDay: snap.seven_day.used_percentage,
    fiveHourResetAt: fiveReset != null ? new Date(fiveReset) : null,
    sevenDayResetAt: sevenReset != null ? new Date(sevenReset) : null,
  };
}

/**
 * UsageData → snapshot. `source` marks who wrote it. Refresher-owned fields
 * (`status`, `next_attempt_at`) are carried verbatim from the previous snapshot so
 * a stdin write never clears an in-flight backoff the poller set.
 */
export function usageToSnapshot(
  usage: UsageData,
  source: UsageSnapshot['source'],
  now: number,
  prev: UsageSnapshot | null,
): UsageSnapshot {
  return {
    updated_at: new Date(now).toISOString(),
    source,
    five_hour: {
      used_percentage: usage.fiveHour,
      resets_at: usage.fiveHourResetAt ? usage.fiveHourResetAt.toISOString() : null,
    },
    seven_day: {
      used_percentage: usage.sevenDay,
      resets_at: usage.sevenDayResetAt ? usage.sevenDayResetAt.toISOString() : null,
    },
    status: prev?.status ?? 'ok',
    next_attempt_at: prev?.next_attempt_at ?? null,
  };
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
      try {
        deps.rmSync(lockPath, { force: true });
      } catch {
        return false;
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

  // Spawn the detached refresher iff the snapshot is past the TTL and not in
  // backoff. Throttled by the single-flight lock; never blocks or throws.
  const maybeRefresh = (s: UsageSnapshot): void => {
    const age = now - (parseMs(s.updated_at) ?? 0);
    const inBackoff =
      s.next_attempt_at != null && (parseMs(s.next_attempt_at) ?? 0) > now;
    if (age > USAGE_TTL_MS && !inBackoff && tryTakeLock(lockPath, now, deps.fs)) {
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
      // resets the idle TTL, so no refresher fires while chatting.
      writeSnapshotAtomic(
        snapshotPath,
        usageToSnapshot(stdinUsage, 'stdin', now, snap),
        now,
        deps.fs,
      );
      return stdinUsage;
    }
    // stdin did NOT advance (cmp <= 0) → frozen stdin, i.e. idle. The snapshot's
    // updated_at keeps aging, so refresh when it goes stale.
    maybeRefresh(snap);
    return cmp < 0 ? snapshotToUsage(snap) : stdinUsage;
  }

  // No stdin usage at all this render (e.g. rate_limits absent). Serve the
  // snapshot and refresh it when stale.
  if (snap == null) return null;
  maybeRefresh(snap);
  return snapshotToUsage(snap);
}

export { defaultSnapshotFs };
