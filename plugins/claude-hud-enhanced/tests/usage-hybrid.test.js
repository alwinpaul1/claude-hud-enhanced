import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  compareStdinSnapshot,
  isStrictlyNewer,
  snapshotToUsage,
  usageToSnapshot,
  tryTakeLock,
  resolveUsage,
  USAGE_TTL_MS,
} from '../dist/usage-hybrid.js';
import { getSnapshotPath, getLockPath, readSnapshot } from '../dist/usage-snapshot.js';

const HOME = '/tmp/hud-test-home';
const SNAP_PATH = getSnapshotPath(HOME);
const LOCK_PATH = getLockPath(HOME);
const DIR = path.dirname(SNAP_PATH);
const NOW = Date.UTC(2026, 6, 18, 12, 0, 0);
const ISO = (ms) => new Date(ms).toISOString();

/** In-memory SnapshotFsDeps backed by a Map, with the plugin dir pre-seeded. */
function makeFs(seedSnapshot) {
  const files = new Map([[DIR, '<dir>']]);
  const mtimes = new Map();
  if (seedSnapshot) {
    files.set(SNAP_PATH, `${JSON.stringify(seedSnapshot)}\n`);
    mtimes.set(SNAP_PATH, Date.parse(seedSnapshot.updated_at));
  }
  return {
    _files: files,
    _mtimes: mtimes,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(p);
    },
    writeFileSync: (p, data, opts) => {
      if (opts && opts.flag === 'wx' && files.has(p)) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      files.set(p, String(data));
      mtimes.set(p, NOW);
    },
    renameSync: (a, b) => {
      files.set(b, files.get(a));
      mtimes.set(b, mtimes.get(a) ?? NOW);
      files.delete(a);
      mtimes.delete(a);
    },
    chmodSync: () => {},
    rmSync: (p) => {
      files.delete(p);
      mtimes.delete(p);
    },
    statSync: (p) => {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { mtimeMs: mtimes.get(p) ?? 0 };
    },
  };
}

function snap(overrides = {}) {
  return {
    updated_at: ISO(NOW),
    source: 'oauth',
    five_hour: { used_percentage: 50, resets_at: ISO(NOW + 3 * 3600_000) },
    seven_day: { used_percentage: 20, resets_at: ISO(NOW + 3 * 86400_000) },
    status: 'ok',
    next_attempt_at: null,
    ...overrides,
  };
}

function stdin(overrides = {}) {
  return {
    fiveHour: 50,
    sevenDay: 20,
    fiveHourResetAt: new Date(NOW + 3 * 3600_000),
    sevenDayResetAt: new Date(NOW + 3 * 86400_000),
    ...overrides,
  };
}

test('compareStdinSnapshot: later 5h reset means stdin newer', () => {
  const s = stdin({ fiveHourResetAt: new Date(NOW + 5 * 3600_000) });
  assert.equal(compareStdinSnapshot(s, snap()), 1);
  assert.equal(isStrictlyNewer(s, snap()), true);
});

test('compareStdinSnapshot: higher 5h percent (same reset) means stdin newer', () => {
  assert.equal(compareStdinSnapshot(stdin({ fiveHour: 80 }), snap()), 1);
});

test('compareStdinSnapshot: snapshot with higher percent is newer (other-device usage)', () => {
  assert.equal(compareStdinSnapshot(stdin({ fiveHour: 40 }), snap({ five_hour: { used_percentage: 90, resets_at: ISO(NOW + 3 * 3600_000) } })), -1);
});

test('compareStdinSnapshot: identical windows compare equal', () => {
  assert.equal(compareStdinSnapshot(stdin(), snap({ source: 'stdin' })), 0);
});

test('snapshot <-> usage roundtrip preserves the 5h/7d windows', () => {
  const u = snapshotToUsage(snap());
  assert.equal(u.fiveHour, 50);
  assert.equal(u.sevenDay, 20);
  assert.equal(u.fiveHourResetAt.getTime(), NOW + 3 * 3600_000);
  const back = usageToSnapshot(u, 'stdin', NOW, null);
  assert.equal(back.five_hour.used_percentage, 50);
  assert.equal(back.source, 'stdin');
});

test('usageToSnapshot carries prior refresher status/backoff verbatim', () => {
  const prev = snap({ status: 'rate_limited', next_attempt_at: ISO(NOW + 60_000) });
  const out = usageToSnapshot(stdin(), 'stdin', NOW, prev);
  assert.equal(out.status, 'rate_limited');
  assert.equal(out.next_attempt_at, ISO(NOW + 60_000));
});

test('tryTakeLock: takes when free, refuses when a fresh lock is held', () => {
  const fs = makeFs();
  assert.equal(tryTakeLock(LOCK_PATH, NOW, fs), true, 'first caller wins');
  assert.equal(tryTakeLock(LOCK_PATH, NOW, fs), false, 'second caller blocked by fresh lock');
});

test('tryTakeLock: reclaims a stale lock', () => {
  const fs = makeFs();
  fs.writeFileSync(LOCK_PATH, '999', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs._mtimes.set(LOCK_PATH, NOW - 120_000); // 2 min old > LOCK_STALE_MS
  assert.equal(tryTakeLock(LOCK_PATH, NOW, fs), true, 'stale lock reclaimed');
});

test('resolveUsage: disabled returns stdin untouched', () => {
  let spawned = 0;
  const out = resolveUsage(stdin(), false, { now: () => NOW, homeDir: HOME, fs: makeFs(), spawnRefresher: () => spawned++ });
  assert.deepEqual(out, stdin());
  assert.equal(spawned, 0);
});

test('resolveUsage active + newer stdin: persists snapshot, returns stdin', () => {
  const fs = makeFs();
  const s = stdin({ fiveHour: 77 });
  const out = resolveUsage(s, true, { now: () => NOW, homeDir: HOME, fs, spawnRefresher: () => {} });
  assert.equal(out, s);
  const written = readSnapshot(SNAP_PATH, fs);
  assert.equal(written.source, 'stdin');
  assert.equal(written.five_hour.used_percentage, 77);
});

test('resolveUsage active + newer snapshot: serves snapshot (other-device usage)', () => {
  const fs = makeFs(snap({ five_hour: { used_percentage: 95, resets_at: ISO(NOW + 3 * 3600_000) } }));
  const out = resolveUsage(stdin({ fiveHour: 40 }), true, { now: () => NOW, homeDir: HOME, fs, spawnRefresher: () => {} });
  assert.equal(out.fiveHour, 95, 'higher account-wide value wins');
});

test('resolveUsage idle + fresh snapshot: serves it, no refresher', () => {
  let spawned = 0;
  const fs = makeFs(snap({ updated_at: ISO(NOW - 10_000) })); // fresh
  const out = resolveUsage(null, true, { now: () => NOW, homeDir: HOME, fs, spawnRefresher: () => spawned++ });
  assert.equal(out.fiveHour, 50);
  assert.equal(spawned, 0, 'fresh snapshot does not trigger a refresh');
});

test('resolveUsage idle + stale snapshot: serves snapshot AND spawns one refresher', () => {
  let spawned = 0;
  const fs = makeFs(snap({ updated_at: ISO(NOW - USAGE_TTL_MS - 1000) })); // stale
  const out = resolveUsage(null, true, { now: () => NOW, homeDir: HOME, fs, spawnRefresher: () => spawned++ });
  assert.equal(out.fiveHour, 50, 'stale-while-revalidate: still serves last value');
  assert.equal(spawned, 1, 'stale snapshot triggers exactly one refresh');
  assert.ok(fs.existsSync(LOCK_PATH), 'refresher lock was taken');
});

test('resolveUsage idle + stale but in backoff: no refresher', () => {
  let spawned = 0;
  const fs = makeFs(snap({ updated_at: ISO(NOW - USAGE_TTL_MS - 1000), next_attempt_at: ISO(NOW + 60_000) }));
  resolveUsage(null, true, { now: () => NOW, homeDir: HOME, fs, spawnRefresher: () => spawned++ });
  assert.equal(spawned, 0, 'backoff suppresses the refresh');
});

test('resolveUsage idle + no snapshot: returns null', () => {
  const out = resolveUsage(null, true, { now: () => NOW, homeDir: HOME, fs: makeFs(), spawnRefresher: () => {} });
  assert.equal(out, null);
});
