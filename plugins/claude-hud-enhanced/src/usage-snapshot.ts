import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';

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
  five_hour: { used_percentage: number | null; resets_at: string | null };
  seven_day: { used_percentage: number | null; resets_at: string | null };
  /** Refresher-owned: outcome of the last OAuth attempt. */
  status: 'ok' | 'rate_limited' | 'auth_expired' | 'error';
  /** Refresher-owned: earliest time the poller should try again (backoff), or null. */
  next_attempt_at: string | null;
}

export const SNAPSHOT_FILENAME = 'usage-snapshot.json';
export const LOCK_FILENAME = '.usage-snapshot.lock';

export function getSnapshotPath(homeDir: string = os.homedir()): string {
  return path.join(getHudPluginDir(homeDir), SNAPSHOT_FILENAME);
}

export function getLockPath(homeDir: string = os.homedir()): string {
  return path.join(getHudPluginDir(homeDir), LOCK_FILENAME);
}

export interface SnapshotFsDeps {
  existsSync: typeof fs.existsSync;
  readFileSync: typeof fs.readFileSync;
  writeFileSync: typeof fs.writeFileSync;
  renameSync: typeof fs.renameSync;
  chmodSync: typeof fs.chmodSync;
  rmSync: typeof fs.rmSync;
  statSync: typeof fs.statSync;
}

export const defaultSnapshotFs: SnapshotFsDeps = {
  existsSync: fs.existsSync,
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  renameSync: fs.renameSync,
  chmodSync: fs.chmodSync,
  rmSync: fs.rmSync,
  statSync: fs.statSync,
};

function isWindow(v: unknown): v is UsageSnapshot['five_hour'] {
  if (typeof v !== 'object' || v === null) return false;
  const w = v as Record<string, unknown>;
  const pctOk = w.used_percentage === null || typeof w.used_percentage === 'number';
  const resetOk = w.resets_at === null || typeof w.resets_at === 'string';
  return pctOk && resetOk;
}

/** Parse a snapshot file, returning null on missing/corrupt/invalid data (tolerant). */
export function readSnapshot(
  snapshotPath: string,
  deps: SnapshotFsDeps = defaultSnapshotFs,
): UsageSnapshot | null {
  try {
    if (!deps.existsSync(snapshotPath)) return null;
    const parsed = JSON.parse(deps.readFileSync(snapshotPath, 'utf8') as string) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const s = parsed as Record<string, unknown>;
    if (typeof s.updated_at !== 'string') return null;
    // Absent on snapshots written before this field existed. Tolerated (and read
    // as never-polled) so an upgrade does not throw away a good last-known value;
    // a wrong TYPE is still a corrupt file.
    if (
      s.oauth_updated_at !== undefined &&
      s.oauth_updated_at !== null &&
      typeof s.oauth_updated_at !== 'string'
    ) {
      return null;
    }
    if (s.source !== 'stdin' && s.source !== 'oauth') return null;
    if (!isWindow(s.five_hour) || !isWindow(s.seven_day)) return null;
    const status = s.status;
    if (status !== 'ok' && status !== 'rate_limited' && status !== 'auth_expired' && status !== 'error') {
      return null;
    }
    if (s.next_attempt_at !== null && typeof s.next_attempt_at !== 'string') return null;
    return parsed as UsageSnapshot;
  } catch {
    return null;
  }
}

/** Atomically write a snapshot (tmp + wx + rename + chmod 0600). Returns success. */
export function writeSnapshotAtomic(
  snapshotPath: string,
  snapshot: UsageSnapshot,
  now: number = Date.now(),
  deps: SnapshotFsDeps = defaultSnapshotFs,
): boolean {
  const dir = path.dirname(snapshotPath);
  const base = path.basename(snapshotPath);
  const tmpPath = path.join(
    dir,
    `.${base}.${process.pid}.${now}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  try {
    if (!deps.existsSync(dir)) return false;
    deps.writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    deps.renameSync(tmpPath, snapshotPath);
    deps.chmodSync(snapshotPath, 0o600);
    return true;
  } catch {
    try {
      deps.rmSync(tmpPath, { force: true });
    } catch {
      /* best effort */
    }
    return false;
  }
}
