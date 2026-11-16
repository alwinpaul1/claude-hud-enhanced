import type { UsageData } from './types.js';
import { type SnapshotFsDeps, type UsageSnapshot, defaultSnapshotFs } from './usage-snapshot.js';
/**
 * ccstatusline-style hybrid usage resolution.
 *
 *   - While CHATTING: Claude Code hands fresh `rate_limits` on stdin. A window
 *     in which stdin is ahead of the snapshot is persisted to the snapshot (which
 *     also resets the idle TTL clock; the LIVE-read gate still polls).
 *   - While IDLE: Claude Code keeps re-sending the last-known FROZEN rate_limits on
 *     every render (stdin usage is essentially never null mid-session). Idle is
 *     therefore detected as "stdin stopped advancing", not "stdin disappeared":
 *     frozen stdin doesn't rewrite the snapshot, so `updated_at` ages, and once it
 *     is past the TTL (and not in backoff) we spawn the detached OAuth refresher
 *     (refresh-usage.js) to pull the live account-wide number (e.g. usage burned on
 *     another device). Rendering never blocks on the network.
 *
 * Newer-detection, per window: resets more than SAME_WINDOW_MS apart are
 * different windows and the later one wins. Inside one window stdin only ever
 * moves the figure forward: a higher stdin reading wins unless it was observed
 * before the snapshot's (each session records when its own reading last changed,
 * see observeStdinUsage), a lower one never does, since a session's stdin lags
 * the account. Only an API reading may lower a figure (refresh-usage.ts). So a
 * stale stdin from an idle session can never clobber a fresher reading.
 */
/** Idle gate: how long the snapshot may sit unwritten before we refresh it. */
export declare const USAGE_TTL_MS = 60000;
/**
 * Active gate: how stale the last LIVE read may get while the user is chatting.
 * stdin re-stamps `updated_at` on every message, so the idle gate alone can never
 * fire mid-conversation — and usage burned in another terminal, on another
 * machine, or on claude.ai would stay invisible until the session went quiet.
 */
export declare const OAUTH_MAX_AGE_MS = 60000;
export declare const LOCK_STALE_MS = 60000;
/**
 * A rejected token (401) waits five minutes: the cure is Claude Code refreshing
 * it or the user signing in again. A profile with no login at all makes no
 * request, so it is rechecked sooner (BACKOFF_NO_LOGIN_MS, a local Keychain
 * lookup) and a fresh /login shows within five minutes.
 */
export declare const BACKOFF_AUTH_MS: number;
export declare const BACKOFF_ERROR_MS = 60000;
/**
 * 429 fallback when the server sent no Retry-After, and the wait after any other
 * failed request: one minute, doubling per consecutive failure up to the cap, plus
 * up to BACKOFF_JITTER on top. A Retry-After the server did send is used as is.
 */
export declare const BACKOFF_RATE_LIMIT_MS = 60000;
export declare const BACKOFF_RATE_LIMIT_MAX_MS: number;
export declare const BACKOFF_ERROR_MAX_MS: number;
export declare const BACKOFF_AUTH_MAX_MS: number;
export declare const BACKOFF_NO_LOGIN_MS: number;
export declare const BACKOFF_FORBIDDEN_MS: number;
export declare const BACKOFF_FORBIDDEN_MAX_MS: number;
export declare const BACKOFF_JITTER = 0.25;
export declare const SAME_WINDOW_MS = 60000;
/**
 * How long a snapshot may go unconfirmed, while its OAuth poll is failing, before
 * the HUD flags the numbers as stale. Without this a poll that broke (an expired
 * token, a network outage) kept rendering the last good reading as if it were
 * live: one profile showed "Weekly 92%" for 33 hours while Claude Code was
 * refusing requests because the weekly limit had been hit.
 */
export declare const USAGE_STALE_MS: number;
export interface StdinSeenAt {
    fiveHour: number | null;
    sevenDay: number | null;
}
export declare function compareStdinSnapshot(stdin: UsageData, snap: UsageSnapshot, stdinSeenAt?: StdinSeenAt | number | null): number;
export declare function observeStdinUsage(session: string | undefined, usage: UsageData | null, now: number, homeDir?: string): StdinSeenAt | null;
/** True when stdin is strictly newer than the snapshot (write-back decision). */
export declare function isStrictlyNewer(stdin: UsageData, snap: UsageSnapshot): boolean;
/** Snapshot → UsageData: the 5h/7d windows plus any model-scoped ones. */
export declare function snapshotToUsage(snap: UsageSnapshot): UsageData;
/**
 * Serve the snapshot's windows while keeping the stdin extras the snapshot lacks
 * (model-scoped windows it has none of, the balance label), so a newer snapshot
 * never makes the Fable weekly bar or balance segment vanish.
 */
export declare function snapshotOverStdin(snap: UsageSnapshot, stdinUsage: UsageData): UsageData;
/**
 * UsageData → snapshot. `source` marks who wrote it. Refresher-owned fields
 * (`oauth_updated_at`, `status`, `next_attempt_at`) are carried verbatim from the
 * previous snapshot so a stdin write never clears an in-flight backoff the poller
 * set, nor forges a LIVE read that never happened.
 */
export declare function usageToSnapshot(usage: UsageData, source: UsageSnapshot['source'], now: number, prev: UsageSnapshot | null): UsageSnapshot;
/**
 * When the snapshot's numbers can no longer be presented as current, the time they
 * were last confirmed (by a stdin advance or a successful OAuth read); null while
 * they are fresh. Only a FAILING poll makes a snapshot stale: with a working one
 * the refresher replaces an aged snapshot within seconds, and flagging it in that
 * gap would flicker a warning after every laptop wake.
 */
export declare function snapshotStaleSince(snap: UsageSnapshot, now: number): Date | null;
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
export declare function shouldRefresh(snap: UsageSnapshot, now: number): boolean;
export interface LockOptions {
    reclaimDead?: boolean;
    isAlive?: (pid: number) => boolean;
}
export declare function isProcessAlive(pid: number): boolean;
/**
 * Try to claim the single-flight refresher lock. Cleans up a stale lock (older than
 * LOCK_STALE_MS, or with `reclaimDead` one whose recorded holder pid is gone) left
 * by a crashed refresher, then creates the lock with `wx` so only
 * one caller wins the race. Returns true iff this caller now holds the lock.
 */
export declare function tryTakeLock(lockPath: string, now: number, deps: SnapshotFsDeps, options?: LockOptions): boolean;
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
    stdinSeenAt?: StdinSeenAt | number | null;
    isAlive?: (pid: number) => boolean;
}
/**
 * Resolve the usage to render, blending live stdin with the persisted snapshot.
 * Never blocks: any OAuth refresh happens in a detached child, and this call only
 * ever reads/writes local files.
 */
export declare function resolveUsage(stdinUsage: UsageData | null, enabled: boolean, deps: HybridDeps): UsageData | null;
export { defaultSnapshotFs };
//# sourceMappingURL=usage-hybrid.d.ts.map