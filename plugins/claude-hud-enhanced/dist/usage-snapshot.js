import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
export const SNAPSHOT_FILENAME = 'usage-snapshot.json';
export const LOCK_FILENAME = '.usage-snapshot.lock';
export function getSnapshotPath(homeDir = os.homedir()) {
    return path.join(getHudPluginDir(homeDir), SNAPSHOT_FILENAME);
}
export function getLockPath(homeDir = os.homedir()) {
    return path.join(getHudPluginDir(homeDir), LOCK_FILENAME);
}
export const defaultSnapshotFs = {
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
    chmodSync: fs.chmodSync,
    rmSync: fs.rmSync,
    statSync: fs.statSync,
};
function isWindow(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const w = v;
    const pctOk = w.used_percentage === null || typeof w.used_percentage === 'number';
    const resetOk = w.resets_at === null || typeof w.resets_at === 'string';
    return pctOk && resetOk;
}
/** Parse a snapshot file, returning null on missing/corrupt/invalid data (tolerant). */
export function readSnapshot(snapshotPath, deps = defaultSnapshotFs) {
    try {
        if (!deps.existsSync(snapshotPath))
            return null;
        const parsed = JSON.parse(deps.readFileSync(snapshotPath, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        const s = parsed;
        if (typeof s.updated_at !== 'string')
            return null;
        if (s.source !== 'stdin' && s.source !== 'oauth')
            return null;
        if (!isWindow(s.five_hour) || !isWindow(s.seven_day))
            return null;
        const status = s.status;
        if (status !== 'ok' && status !== 'rate_limited' && status !== 'auth_expired' && status !== 'error') {
            return null;
        }
        if (s.next_attempt_at !== null && typeof s.next_attempt_at !== 'string')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/** Atomically write a snapshot (tmp + wx + rename + chmod 0600). Returns success. */
export function writeSnapshotAtomic(snapshotPath, snapshot, now = Date.now(), deps = defaultSnapshotFs) {
    const dir = path.dirname(snapshotPath);
    const base = path.basename(snapshotPath);
    const tmpPath = path.join(dir, `.${base}.${process.pid}.${now}.${Math.random().toString(36).slice(2)}.tmp`);
    try {
        if (!deps.existsSync(dir))
            return false;
        deps.writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
            flag: 'wx',
        });
        deps.renameSync(tmpPath, snapshotPath);
        deps.chmodSync(snapshotPath, 0o600);
        return true;
    }
    catch {
        try {
            deps.rmSync(tmpPath, { force: true });
        }
        catch {
            /* best effort */
        }
        return false;
    }
}
//# sourceMappingURL=usage-snapshot.js.map