import type { UsageData } from './types.js';
import { type SnapshotFsDeps, type UsageSnapshot, defaultSnapshotFs } from './usage-snapshot.js';
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
export declare const USAGE_TTL_MS = 180000;
export declare const LOCK_STALE_MS = 60000;
/** +1 if stdin is newer than the snapshot, -1 if the snapshot is newer, 0 if equal. */
export declare function compareStdinSnapshot(stdin: UsageData, snap: UsageSnapshot): number;
/** True when stdin is strictly newer than the snapshot (write-back decision). */
export declare function isStrictlyNewer(stdin: UsageData, snap: UsageSnapshot): boolean;
/** Snapshot → UsageData. Note: snapshots only carry the 5h/7d windows. */
export declare function snapshotToUsage(snap: UsageSnapshot): UsageData;
/**
 * UsageData → snapshot. `source` marks who wrote it. Refresher-owned fields
 * (`status`, `next_attempt_at`) are carried verbatim from the previous snapshot so
 * a stdin write never clears an in-flight backoff the poller set.
 */
export declare function usageToSnapshot(usage: UsageData, source: UsageSnapshot['source'], now: number, prev: UsageSnapshot | null): UsageSnapshot;
/**
 * Try to claim the single-flight refresher lock. Cleans up a stale lock (older than
 * LOCK_STALE_MS) left by a crashed refresher, then creates the lock with `wx` so only
 * one caller wins the race. Returns true iff this caller now holds the lock.
 */
export declare function tryTakeLock(lockPath: string, now: number, deps: SnapshotFsDeps): boolean;
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
export declare function resolveUsage(stdinUsage: UsageData | null, enabled: boolean, deps: HybridDeps): UsageData | null;
export { defaultSnapshotFs };
//# sourceMappingURL=usage-hybrid.d.ts.map