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
const DAY = 86400_000;
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
    _now: NOW, // settable clock so writes get a realistic mtime
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files.get(p);
    },
    writeFileSync(p, data, opts) {
      if (opts && opts.flag === 'wx' && files.has(p)) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      files.set(p, String(data));
      mtimes.set(p, this._now);
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

// Safety-critical: after a window reset, fresh low-percent stdin (later resets_at)
// must beat a previous-window snapshot stuck at a high percent — reset comparison
// runs BEFORE percent comparison.
test('compareStdinSnapshot: post-reset stdin beats a high-percent previous-window snapshot', () => {
  const s = stdin({ fiveHour: 5, fiveHourResetAt: new Date(NOW + 5 * 3600_000) });
  const prevWindow = snap({ five_hour: { used_percentage: 90, resets_at: ISO(NOW - 3600_000) } });
  assert.equal(compareStdinSnapshot(s, prevWindow), 1, 'later reset wins regardless of percent');
});

test('compareStdinSnapshot: null resets_at is undecidable (equal)', () => {
  const s = stdin({ fiveHourResetAt: null, sevenDayResetAt: null, fiveHour: 80 });
  assert.equal(compareStdinSnapshot(s, snap()), 0, 'missing reset on one side cannot decide');
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

test('tryTakeLock: stale-reclaim race — the rename loser backs off and cannot steal the winner\'s lock', () => {
  // Simulate two racers hitting the stale branch together. Racer A completes
  // the rename-steal and holds a fresh lock. Racer B saw the stale lock too,
  // but by the time B renames, the source is gone → real fs throws ENOENT.
  const fs = makeFs();
  fs.writeFileSync(LOCK_PATH, '999', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs._mtimes.set(LOCK_PATH, NOW - 120_000); // stale

  // Racer B's view: interpose a renameSync that throws like the real fs when
  // the source no longer exists (makeFs's default silently "succeeds").
  const strictFs = {
    ...fs,
    renameSync: (a, b) => {
      if (!fs.existsSync(a)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      fs.renameSync(a, b);
    },
  };

  assert.equal(tryTakeLock(LOCK_PATH, NOW, strictFs), true, 'racer A reclaims');
  // B is still executing its stale branch (it stat'ed the OLD lock before A's
  // rename). B's rename now finds no source and must lose WITHOUT touching
  // A's fresh lock. Model B's staleness view by re-running against a stale
  // stat: force the mtime check to pass by backdating, then restore.
  const freshLockMtime = fs._mtimes.get(LOCK_PATH);
  fs._mtimes.set(LOCK_PATH, NOW - 120_000); // B's stale view of the lock it stat'ed
  const bFs = {
    ...strictFs,
    // B's rename targets the CURRENT lock path; in the buggy rm-based code B
    // would force-remove A's lock here and "win". With rename-steal, exactly
    // one rename of the original source can succeed — emulate B racing on a
    // source that A already renamed away by making B's rename throw.
    renameSync: () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  };
  assert.equal(tryTakeLock(LOCK_PATH, NOW, bFs), false, 'racer B backs off');
  fs._mtimes.set(LOCK_PATH, freshLockMtime);
  assert.equal(fs.existsSync(LOCK_PATH), true, "racer A's lock survives B's attempt");
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

test('resolveUsage stale + canRefresh false: no lock, no spawn (churn guard)', () => {
  let spawned = 0;
  const fs = makeFs(snap({ updated_at: ISO(NOW - USAGE_TTL_MS - 1000) })); // stale
  resolveUsage(null, true, {
    now: () => NOW, homeDir: HOME, fs,
    spawnRefresher: () => spawned++,
    canRefresh: () => false, // refresher script not installed
  });
  assert.equal(spawned, 0, 'no spawn when refresher cannot run');
  assert.equal(fs.existsSync(LOCK_PATH), false, 'no lock file churn either');
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

// The real-world idle shape: Claude Code keeps RE-SENDING the last frozen
// rate_limits on every render — stdin usage is never null mid-session. Idle must
// be detected as "stdin stopped advancing", not "stdin disappeared".
test('resolveUsage frozen stdin: refresher fires once the snapshot goes stale', () => {
  let spawned = 0;
  const fs = makeFs();
  const deps = (t) => {
    fs._now = t; // keep the fake fs mtime clock in sync with the render time
    return { now: () => t, homeDir: HOME, fs, spawnRefresher: () => spawned++ };
  };

  // T=0: user messages — fresh stdin writes the snapshot (updated_at = NOW).
  const s = stdin();
  resolveUsage(s, true, deps(NOW));
  assert.equal(readSnapshot(SNAP_PATH, fs).updated_at, ISO(NOW));

  // Idle renders with the SAME frozen stdin, inside the TTL: no refresh.
  resolveUsage(s, true, deps(NOW + 60_000));
  resolveUsage(s, true, deps(NOW + 120_000));
  assert.equal(spawned, 0, 'fresh snapshot suppresses refresh while frozen');
  assert.equal(readSnapshot(SNAP_PATH, fs).updated_at, ISO(NOW), 'frozen stdin must not bump updated_at');

  // Past the TTL, still the same frozen stdin: exactly one refresh fires.
  const later = NOW + USAGE_TTL_MS + 30_000;
  const out = resolveUsage(s, true, deps(later));
  assert.equal(spawned, 1, 'stale snapshot + frozen stdin triggers the refresher');
  assert.equal(out, s, 'equal stdin/snapshot still renders the stdin values');

  // Next render 300ms later: the lock throttles — no second spawn.
  resolveUsage(s, true, deps(later + 300));
  assert.equal(spawned, 1, 'single-flight lock prevents a refresher stampede');
});

test('resolveUsage frozen stdin + newer OAuth snapshot: serves the snapshot', () => {
  // The refresher wrote a fresher account-wide value (other-device usage).
  const fs = makeFs(snap({
    five_hour: { used_percentage: 90, resets_at: ISO(NOW + 3 * 3600_000) },
    updated_at: ISO(NOW - 10_000),
  }));
  let spawned = 0;
  const scoped = [{ label: 'Fable', percent: 12, resetAt: new Date(NOW + DAY) }];
  const out = resolveUsage(
    stdin({ fiveHour: 40, scopedWindows: scoped, balanceLabel: '¥6.35' }),
    true,
    { now: () => NOW, homeDir: HOME, fs, spawnRefresher: () => spawned++ },
  );
  assert.equal(out.fiveHour, 90, 'newer OAuth snapshot wins over frozen stdin');
  assert.equal(spawned, 0, 'fresh snapshot needs no refresh');
  assert.deepEqual(out.scopedWindows, scoped, 'stdin-only scoped windows survive snapshot serving');
  assert.equal(out.balanceLabel, '¥6.35', 'stdin-only balance label survives snapshot serving');
});

test('resolveUsage active stdin advance resets the idle clock', () => {
  let spawned = 0;
  const fs = makeFs(snap({ updated_at: ISO(NOW - USAGE_TTL_MS - 1000) })); // stale
  const s = stdin({ fiveHour: 60 }); // stdin ADVANCED past the snapshot's 50
  const deps = { now: () => NOW, homeDir: HOME, fs, spawnRefresher: () => spawned++ };
  const out = resolveUsage(s, true, deps);
  assert.equal(out, s, 'advancing stdin is authoritative');
  assert.equal(spawned, 0, 'activity suppresses the refresher even with a stale snapshot');
  assert.equal(readSnapshot(SNAP_PATH, fs).updated_at, ISO(NOW), 'advance stamps updated_at');
});
