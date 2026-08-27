import * as fs from 'node:fs';
/**
 * Persisted usage snapshot shared by the hybrid resolver (writer on interaction)
 * and the detached OAuth refresher (writer while idle). Lives in the per-profile
 * HUD data dir so custom CLAUDE_CONFIG_DIR profiles never mix tokens/snapshots.
 */
export interface UsageSnapshot {
    /** ISO timestamp — the idle-TTL clock; bumped by whichever writer refreshed values. */
    updated_at: string;
    /**
     * ISO timestamp of the last LIVE (OAuth) read, on its own clock — null when we
     * have never had one. Separate from `updated_at` because stdin carries only THIS
     * session's view from response headers and re-stamps `updated_at` on every
     * message: an `updated_at`-only gate can never fire while the user is chatting,
     * so usage burned elsewhere stays invisible for the whole session. Only the
     * refresher may move this.
     */
    oauth_updated_at: string | null;
    source: 'stdin' | 'oauth';
    five_hour: {
        used_percentage: number | null;
        resets_at: string | null;
    };
    seven_day: {
        used_percentage: number | null;
        resets_at: string | null;
    };
    /** Refresher-owned: outcome of the last OAuth attempt. */
    status: 'ok' | 'rate_limited' | 'auth_expired' | 'error';
    /** Refresher-owned: earliest time the poller should try again (backoff), or null. */
    next_attempt_at: string | null;
}
export declare const SNAPSHOT_FILENAME = "usage-snapshot.json";
export declare const LOCK_FILENAME = ".usage-snapshot.lock";
export declare function getSnapshotPath(homeDir?: string): string;
export declare function getLockPath(homeDir?: string): string;
export interface SnapshotFsDeps {
    existsSync: typeof fs.existsSync;
    readFileSync: typeof fs.readFileSync;
    writeFileSync: typeof fs.writeFileSync;
    renameSync: typeof fs.renameSync;
    chmodSync: typeof fs.chmodSync;
    rmSync: typeof fs.rmSync;
    statSync: typeof fs.statSync;
}
export declare const defaultSnapshotFs: SnapshotFsDeps;
/** Parse a snapshot file, returning null on missing/corrupt/invalid data (tolerant). */
export declare function readSnapshot(snapshotPath: string, deps?: SnapshotFsDeps): UsageSnapshot | null;
/** Atomically write a snapshot (tmp + wx + rename + chmod 0600). Returns success. */
export declare function writeSnapshotAtomic(snapshotPath: string, snapshot: UsageSnapshot, now?: number, deps?: SnapshotFsDeps): boolean;
//# sourceMappingURL=usage-snapshot.d.ts.map