import { testRoot } from './helpers/isolate-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyIdleUsageReset } from '../dist/idle-usage-reset.js';
import {
  BACKOFF_AUTH_MAX_MS,
  BACKOFF_AUTH_MS,
  BACKOFF_ERROR_MAX_MS,
  BACKOFF_ERROR_MS,
  BACKOFF_FORBIDDEN_MAX_MS,
  BACKOFF_FORBIDDEN_MS,
  BACKOFF_JITTER,
  BACKOFF_NO_LOGIN_MS,
  BACKOFF_RATE_LIMIT_MAX_MS,
  BACKOFF_RATE_LIMIT_MS,
  LOCK_STALE_MS,
  OAUTH_MAX_AGE_MS,
  USAGE_TTL_MS,
  compareStdinSnapshot,
  defaultSnapshotFs,
  observeStdinUsage,
  resolveUsage,
  shouldRefresh,
  tryTakeLock,
} from '../dist/usage-hybrid.js';
import { getLockPath, getSnapshotPath, readSnapshot } from '../dist/usage-snapshot.js';
import {
  accountsDir,
  backoffMs,
  classifyResponse,
  failureSnapshot,
  parseUsageResponse,
  readAccountKey,
  refreshUsage,
  successSnapshot,
} from '../dist/refresh-usage.js';

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ISO = (ms) => new Date(ms).toISOString();
const FIVE_RESET = NOW + 3 * HOUR;
const SEVEN_RESET = NOW + 3 * DAY;

const newHome = (label = 'usage-home') => {
  const home = mkdtempSync(path.join(testRoot, `${label}-`));
  mkdirSync(path.join(home, '.claude', 'plugins', 'claude-hud-enhanced'), { recursive: true });
  return home;
};

const snap = (overrides = {}) => ({
  updated_at: ISO(NOW - 10_000),
  oauth_updated_at: ISO(NOW - 10_000),
  source: 'oauth',
  five_hour: { used_percentage: 50, resets_at: ISO(FIVE_RESET), seen_at: ISO(NOW - 10_000) },
  seven_day: { used_percentage: 20, resets_at: ISO(SEVEN_RESET), seen_at: ISO(NOW - 10_000) },
  status: 'ok',
  next_attempt_at: null,
  ...overrides,
});

const stdin = (overrides = {}) => ({
  fiveHour: 50,
  sevenDay: 20,
  fiveHourResetAt: new Date(FIVE_RESET),
  sevenDayResetAt: new Date(SEVEN_RESET),
  ...overrides,
});

function world(seed) {
  const homeDir = newHome();
  const snapshotPath = getSnapshotPath(homeDir);
  if (seed) writeFileSync(snapshotPath, JSON.stringify(seed));
  let spawned = 0;
  const resolve = (usage, options = {}) =>
    resolveUsage(usage, true, {
      now: () => options.now ?? NOW,
      homeDir,
      fs: defaultSnapshotFs,
      spawnRefresher: () => {
        spawned += 1;
      },
      stdinSeenAt: options.seenAt ?? null,
      isAlive: options.isAlive,
    });
  return {
    homeDir,
    snapshotPath,
    lockPath: getLockPath(homeDir),
    resolve,
    spawned: () => spawned,
    disk: () => readSnapshot(snapshotPath),
  };
}

test('the same window stated to a different fraction of a second is one window', () => {
  const jittered = snap({ five_hour: { used_percentage: 42, resets_at: ISO(FIVE_RESET + 497), seen_at: ISO(NOW - 10_000) } });
  assert.equal(compareStdinSnapshot(stdin({ fiveHour: 50 }), jittered), 1, 'the higher reading is newer, not the later millisecond');
  assert.equal(compareStdinSnapshot(stdin({ fiveHour: 42 }), jittered), 0);
  assert.equal(compareStdinSnapshot(stdin({ fiveHour: 30 }), jittered), -1);
  assert.equal(compareStdinSnapshot(stdin({ fiveHour: 1, fiveHourResetAt: new Date(FIVE_RESET + 5 * HOUR) }), jittered), 1);

  const active = world(jittered);
  const shown = active.resolve(stdin({ fiveHour: 50 }), { seenAt: NOW });
  assert.equal(shown.fiveHour, 50, 'a live session shows its own fresh reading');
  assert.equal(active.disk().five_hour.used_percentage, 50, 'and shares it with every other session');

  const idle = world(snap({ five_hour: { used_percentage: 50, resets_at: ISO(FIVE_RESET - 400), seen_at: ISO(NOW - 10_000) } }));
  assert.equal(idle.resolve(stdin({ fiveHour: 42 }), { seenAt: NOW - HOUR }).fiveHour, 50, 'an idle session cannot put its old figure back');
  assert.equal(idle.disk().five_hour.used_percentage, 50);
  assert.equal(idle.disk().updated_at, ISO(NOW - 10_000), 'and does not re-stamp the snapshot');
});

test('inside a window a stdin reading only ever moves the figure forward', () => {
  const older = world(snap());
  assert.equal(older.resolve(stdin({ fiveHour: 55 }), { seenAt: NOW - HOUR }).fiveHour, 50, 'a higher stdin reading taken before the poll loses to the poll');
  assert.equal(older.disk().five_hour.used_percentage, 50);

  const lagging = world(snap());
  assert.equal(lagging.resolve(stdin({ fiveHour: 48 }), { seenAt: NOW - 1_000 }).fiveHour, 50, 'a session lagging the account cannot pull the figure back');
  assert.equal(lagging.disk().five_hour.used_percentage, 50);
  assert.equal(lagging.disk().updated_at, ISO(NOW - 10_000));
  const moved = lagging.resolve(stdin({ fiveHour: 58 }), { seenAt: NOW });
  assert.equal(moved.fiveHour, 58, 'a later, higher reading moves it forward');
  assert.equal(lagging.disk().five_hour.used_percentage, 58);
  assert.equal(lagging.disk().five_hour.seen_at, ISO(NOW));
  assert.equal(lagging.disk().seven_day.seen_at, ISO(NOW - 10_000), 'the window stdin did not move keeps its own observation time');

  const unknown = world(snap());
  assert.equal(unknown.resolve(stdin({ fiveHour: 48 })).fiveHour, 50);
  assert.equal(unknown.resolve(stdin({ fiveHour: 61 })).fiveHour, 61, 'with no observation time a higher figure still counts');

  const polled = successSnapshot({ five_hour: { used_percentage: 44, resets_at: ISO(FIVE_RESET) }, seven_day: { used_percentage: 20, resets_at: ISO(SEVEN_RESET) } }, NOW, lagging.disk());
  assert.equal(polled.five_hour.used_percentage, 44, 'the newest API reading replaces an older figure, higher or lower');
});

test('a refused request reading 0% never clears a reached limit', () => {
  const reached = world(snap({ five_hour: { used_percentage: 0, resets_at: ISO(FIVE_RESET), seen_at: ISO(NOW - 1_000) } }));
  assert.equal(reached.resolve(stdin({ fiveHour: 100 }), { seenAt: NOW - HOUR }).fiveHour, 100);
  const kept = world(snap({ five_hour: { used_percentage: 100, resets_at: ISO(FIVE_RESET), seen_at: ISO(NOW - HOUR) } }));
  assert.equal(kept.resolve(stdin({ fiveHour: 0 }), { seenAt: NOW }).fiveHour, 100);
  const prev = snap({ five_hour: { used_percentage: 100, resets_at: ISO(FIVE_RESET), seen_at: ISO(NOW - HOUR) } });
  const polled = successSnapshot({ five_hour: { used_percentage: 0, resets_at: ISO(FIVE_RESET + 300) }, seven_day: { used_percentage: 21, resets_at: ISO(SEVEN_RESET) } }, NOW, prev);
  assert.equal(polled.five_hour.used_percentage, 100);
  assert.equal(polled.seven_day.used_percentage, 21);
});

test('each window is judged on its own: a newer 5h from stdin keeps a newer 7d from the poll', () => {
  const w = world(snap({ seven_day: { used_percentage: 33, resets_at: ISO(SEVEN_RESET), seen_at: ISO(NOW - 10_000) } }));
  const shown = w.resolve(stdin({ fiveHour: 58, sevenDay: 20 }), { seenAt: NOW - HOUR });
  assert.equal(shown.fiveHour, 50);
  assert.equal(shown.sevenDay, 33);
  const later = w.resolve(stdin({ fiveHour: 58, sevenDay: 20, sevenDayResetAt: new Date(SEVEN_RESET - 7 * DAY) }), { seenAt: NOW });
  assert.equal(later.fiveHour, 58);
  assert.equal(later.sevenDay, 33, 'a reading for a window that is over never replaces the current one');
  assert.equal(w.disk().seven_day.used_percentage, 33);
});

test('a window stdin does not carry keeps the last known one, on screen and on disk', () => {
  const w = world(snap());
  const shown = w.resolve(stdin({ fiveHour: 70, sevenDay: null, sevenDayResetAt: null }), { seenAt: NOW });
  assert.equal(shown.fiveHour, 70);
  assert.equal(shown.sevenDay, 20);
  assert.equal(shown.sevenDayResetAt.getTime(), SEVEN_RESET);
  assert.equal(w.disk().seven_day.used_percentage, 20);
});

test('a reset that has passed asks for a fresh reading at once and reads 0% meanwhile', () => {
  const passed = snap({
    updated_at: ISO(NOW - 5_000),
    oauth_updated_at: ISO(NOW - 30_000),
    five_hour: { used_percentage: 80, resets_at: ISO(NOW - 1_000), seen_at: ISO(NOW - 30_000) },
  });
  assert.equal(shouldRefresh(snap({ updated_at: ISO(NOW - 5_000), oauth_updated_at: ISO(NOW - 30_000) }), NOW), false, 'both clocks fresh: no poll');
  assert.equal(shouldRefresh(passed, NOW), true, 'the 5h reset passed since the last live read');
  assert.equal(shouldRefresh({ ...passed, oauth_updated_at: ISO(NOW - 500) }, NOW), false, 'one live read after the reset settles it');
  assert.equal(shouldRefresh({ ...passed, next_attempt_at: ISO(NOW + 60_000) }, NOW), false, 'a back-off the server asked for still holds');
  assert.equal(shouldRefresh(snap({ updated_at: ISO(NOW - 5_000), oauth_updated_at: ISO(NOW - 30_000), seven_day: { used_percentage: 90, resets_at: ISO(NOW - 1), seen_at: null } }), NOW), true);

  const w = world(passed);
  const shown = applyIdleUsageReset(w.resolve(stdin({ fiveHour: 80, fiveHourResetAt: new Date(NOW - 1_000) })), NOW);
  assert.equal(w.spawned(), 1);
  assert.equal(shown.fiveHour, 0);
  assert.equal(shown.fiveHourResetAt.getTime(), NOW - 1_000 + 5 * HOUR);
  assert.equal(shown.sevenDay, 20);
});

test('a lock left by a dead refresher does not hold the next refresh back', () => {
  const stale = snap({ updated_at: ISO(NOW - USAGE_TTL_MS - 1), oauth_updated_at: ISO(NOW - USAGE_TTL_MS - 1) });
  const lockAt = new Date(NOW - 5_000);
  const withLock = (content, isAlive) => {
    const w = world(stale);
    writeFileSync(w.lockPath, content);
    utimesSync(w.lockPath, lockAt, lockAt);
    w.resolve(null, { isAlive });
    return w;
  };
  assert.equal(withLock('4242', () => false).spawned(), 1, 'holder gone: reclaimed after 5s, not 60s');
  assert.equal(withLock('4242', () => true).spawned(), 0, 'holder alive: single flight holds');
  assert.equal(withLock('not-a-pid', () => false).spawned(), 0, 'an unreadable holder waits out the stale window');
  assert.equal(withLock(String(process.pid), () => false).spawned(), 0);

  const old = world(stale);
  writeFileSync(old.lockPath, 'not-a-pid');
  utimesSync(old.lockPath, new Date(NOW - LOCK_STALE_MS - 1), new Date(NOW - LOCK_STALE_MS - 1));
  old.resolve(null);
  assert.equal(old.spawned(), 1, 'any lock older than the stale window is reclaimed');

  const dir = mkdtempSync(path.join(testRoot, 'lock-'));
  const plain = path.join(dir, 'spawn.lock');
  writeFileSync(plain, '4242');
  utimesSync(plain, lockAt, lockAt);
  assert.equal(tryTakeLock(plain, NOW, defaultSnapshotFs), false, 'callers that did not ask for it keep the fixed window');
  assert.equal(tryTakeLock(plain, NOW, defaultSnapshotFs, { reclaimDead: true, isAlive: () => false }), true);
  assert.equal(readFileSync(plain, 'utf8'), String(process.pid));
});

test('the API saying a window does not exist is shown honestly, with stdin as the fallback', () => {
  const noFive = snap({ five_hour: { used_percentage: null, resets_at: null, seen_at: ISO(NOW - 10_000) } });

  const maxPlan = world(noFive);
  const weeklyOnly = maxPlan.resolve(stdin({ fiveHour: null, fiveHourResetAt: null, sevenDay: 22 }), { seenAt: NOW });
  assert.equal(weeklyOnly.fiveHour, null, 'no 5h window anywhere: none is invented');
  assert.equal(weeklyOnly.sevenDay, 22);
  assert.equal(maxPlan.resolve(null).fiveHour, null);
  assert.equal(maxPlan.disk().five_hour.used_percentage, null);

  const team = world(snap({
    five_hour: { used_percentage: null, resets_at: null, seen_at: ISO(NOW - 10_000) },
    seven_day: { used_percentage: null, resets_at: null, seen_at: ISO(NOW - 10_000) },
  }));
  const fallback = team.resolve(stdin({ fiveHour: 37, sevenDay: 12 }), { seenAt: NOW - HOUR });
  assert.equal(fallback.fiveHour, 37, 'stdin still carries live windows: the bars are not blanked');
  assert.equal(fallback.sevenDay, 12);
  assert.equal(team.disk().five_hour.used_percentage, null, 'the poll\'s answer is not overwritten by the fallback');

  const ended = world(noFive);
  const over = ended.resolve(stdin({ fiveHour: 80, fiveHourResetAt: new Date(NOW - HOUR) }), { seenAt: NOW - 2 * HOUR });
  assert.equal(over.fiveHour, null, 'a window that ended before the poll looked is gone, not shown at 0%');
  assert.equal(over.sevenDay, 20);

  const legacy = world(snap({ five_hour: { used_percentage: null, resets_at: null } }));
  assert.equal(legacy.resolve(stdin({ fiveHour: 9 })).fiveHour, 9, 'an empty slot nobody polled is simply filled');
  assert.equal(legacy.disk().five_hour.used_percentage, 9);
});

test('a rate-limited poll neither blanks nor freezes the display', () => {
  const limited = failureSnapshot(snap(), 'rate_limited', NOW - 1_000, 10 * 60_000);
  assert.equal(limited.status, 'rate_limited');
  assert.equal(limited.five_hour.used_percentage, 50);
  const w = world(limited);

  assert.equal(w.resolve(null).fiveHour, 50, 'the last reading stays on screen');
  assert.equal(w.resolve(stdin({ fiveHour: 50 })).fiveHour, 50);
  const live = w.resolve(stdin({ fiveHour: 64, sevenDay: 23 }), { seenAt: NOW });
  assert.equal(live.fiveHour, 64, 'a live session keeps moving the figure');
  assert.equal(live.staleSince, undefined);
  assert.equal(w.disk().five_hour.used_percentage, 64);
  assert.equal(w.disk().status, 'rate_limited');
  assert.equal(w.disk().next_attempt_at, limited.next_attempt_at, 'the back-off survives stdin writes');
  assert.equal(w.resolve(stdin({ fiveHour: 64, sevenDay: 23 }), { now: NOW + 5 * 60_000 }).fiveHour, 64);
  assert.equal(w.spawned(), 0, 'nothing is requested until the server allows it');
  w.resolve(stdin({ fiveHour: 64, sevenDay: 23 }), { now: NOW + 10 * 60_000 });
  assert.equal(w.spawned(), 1, 'and exactly one request once it does');
});

test('each session remembers, per window, when its own stdin reading last changed', () => {
  const homeDir = newHome('seen');
  const none = { fiveHour: null, sevenDay: null };
  const first = stdin({ fiveHour: 10 });
  assert.deepEqual(observeStdinUsage('/t/a.jsonl', first, NOW, homeDir), none, 'first sight: its age is unknown');
  assert.deepEqual(observeStdinUsage('/t/a.jsonl', first, NOW + 5_000, homeDir), none);
  assert.deepEqual(observeStdinUsage('/t/a.jsonl', stdin({ fiveHour: 11 }), NOW + 9_000, homeDir), { fiveHour: NOW + 9_000, sevenDay: null }, 'only the figure that changed was observed');
  assert.deepEqual(observeStdinUsage('/t/a.jsonl', stdin({ fiveHour: 11 }), NOW + HOUR, homeDir), { fiveHour: NOW + 9_000, sevenDay: null }, 'frozen since then');
  assert.deepEqual(observeStdinUsage('/t/a.jsonl', stdin({ fiveHour: 11, sevenDay: 21 }), NOW + 2 * HOUR, homeDir), { fiveHour: NOW + 9_000, sevenDay: NOW + 2 * HOUR });
  assert.deepEqual(
    observeStdinUsage('/t/a.jsonl', stdin({ fiveHour: null, fiveHourResetAt: null, sevenDay: 21 }), NOW + 3 * HOUR, homeDir),
    { fiveHour: null, sevenDay: NOW + 2 * HOUR },
    'a window dropping out of stdin does not re-stamp the other as fresh',
  );
  assert.deepEqual(
    observeStdinUsage('/t/a.jsonl', stdin({ fiveHour: 11, fiveHourResetAt: new Date(FIVE_RESET + 400), sevenDay: 21 }), NOW + 4 * HOUR, homeDir).sevenDay,
    NOW + 2 * HOUR,
  );
  assert.deepEqual(observeStdinUsage('/t/b.jsonl', stdin({ fiveHour: 11 }), NOW + HOUR, homeDir), none, 'another session has its own clock');
  assert.equal(observeStdinUsage(undefined, first, NOW, homeDir), null);
  assert.equal(observeStdinUsage('/t/a.jsonl', null, NOW, homeDir), null);
  assert.equal(observeStdinUsage('/t/a.jsonl', stdin({ fiveHour: 11, sevenDay: 21 }), NOW, homeDir).sevenDay, null, 'a time from the future is not trusted');
});

test('every shown window says when it was last confirmed, and a plan without one says so', () => {
  const w = world(snap({ five_hour: { used_percentage: 50, resets_at: ISO(FIVE_RESET), seen_at: ISO(NOW - 4 * 60_000) } }));
  const idle = w.resolve(stdin({ fiveHour: 50 }));
  assert.equal(idle.fiveHourSeenAt.getTime(), NOW - 4 * 60_000, 'an unchanged figure is as old as the reading that confirmed it');
  assert.equal(idle.sevenDaySeenAt.getTime(), NOW - 10_000);
  assert.equal(w.resolve(null).fiveHourSeenAt.getTime(), NOW - 4 * 60_000);
  assert.equal(w.resolve(stdin({ fiveHour: 53 }), { seenAt: NOW }).fiveHourSeenAt.getTime(), NOW, 'a figure this session just moved is current');

  const absent = world(snap({ five_hour: { used_percentage: null, resets_at: null, seen_at: ISO(NOW - 10_000) } }));
  const none = absent.resolve(stdin({ fiveHour: null, fiveHourResetAt: null }));
  assert.equal(none.fiveHour, null);
  assert.equal(none.fiveHourUnlimited, true, 'the API said the plan has no 5h window');
  assert.equal(none.sevenDayUnlimited, undefined);
  const fallback = absent.resolve(stdin({ fiveHour: 37 }));
  assert.equal(fallback.fiveHour, 37);
  assert.equal(fallback.fiveHourUnlimited, undefined);
  assert.equal(fallback.fiveHourSeenAt, null, 'a stdin fallback nobody has confirmed is marked as such');

  const untracked = resolveUsage(stdin(), false, { now: () => NOW, homeDir: w.homeDir, fs: defaultSnapshotFs, spawnRefresher: () => undefined });
  assert.equal('fiveHourSeenAt' in untracked, false, 'with the poll off nothing is claimed about age');
  const over = world(snap({ five_hour: { used_percentage: 80, resets_at: ISO(NOW - 1_000), seen_at: ISO(NOW - 30_000) } }));
  const rolled = applyIdleUsageReset(over.resolve(stdin({ fiveHour: 80, fiveHourResetAt: new Date(NOW - 1_000) })), NOW);
  assert.equal(rolled.fiveHourRolled, true);
  assert.equal(rolled.sevenDayRolled, undefined);
});

test('the poll is due a minute after the last API answer and no back-off undercuts that', () => {
  assert.equal(USAGE_TTL_MS, 60_000);
  assert.equal(OAUTH_MAX_AGE_MS, 60_000);
  for (const base of [BACKOFF_AUTH_MS, BACKOFF_ERROR_MS, BACKOFF_RATE_LIMIT_MS, BACKOFF_NO_LOGIN_MS]) assert.ok(base >= USAGE_TTL_MS);
  assert.equal(BACKOFF_FORBIDDEN_MS, 60 * 60_000);
  const answered = (ago) => snap({ updated_at: ISO(NOW - 1_000), oauth_updated_at: ISO(NOW - ago), source: 'stdin' });
  assert.equal(shouldRefresh(answered(59_000), NOW), false);
  assert.equal(shouldRefresh(answered(61_000), NOW), true, 'stdin writes do not postpone the poll');
});

const PLAN_BODIES = {
  pro: {
    five_hour: { utilization: 31, resets_at: '2026-11-16T15:00:00.497+00:00' },
    seven_day: { utilization: 12, resets_at: '2026-11-21T09:00:00.120+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
    limits: [
      { kind: 'session', group: 'session', percent: 31, resets_at: '2026-11-16T15:00:00.497+00:00', scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 12, resets_at: '2026-11-21T09:00:00.120+00:00', scope: null },
    ],
  },
  max5x: {
    five_hour: { utilization: 8.5, resets_at: '2026-11-16T15:00:00+00:00' },
    seven_day: { utilization: 40, resets_at: '2026-11-21T09:00:00+00:00' },
    seven_day_opus: { utilization: 55, resets_at: '2026-11-21T09:00:00+00:00' },
    seven_day_sonnet: { utilization: 3, resets_at: '2026-11-21T09:00:00+00:00' },
    extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.68 },
  },
  max20xWeeklyOnly: {
    five_hour: null,
    seven_day: { utilization: 61, resets_at: '2026-11-21T09:00:00+00:00' },
    seven_day_opus: { utilization: 70, resets_at: '2026-11-21T09:00:00+00:00' },
    extra_usage: { is_enabled: true, monthly_limit: 20000, used_credits: 0, utilization: 0 },
    limits: [
      { kind: 'weekly_all', group: 'weekly', percent: 61, resets_at: '2026-11-21T09:00:00+00:00', scope: null },
      { kind: 'weekly_scoped', group: 'weekly', percent: 9, resets_at: '2026-11-21T10:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null } },
      { kind: 'weekly_scoped', group: 'weekly', percent: 70, resets_at: '2026-11-21T09:00:00+00:00', scope: { model: { id: null, display_name: 'Opus' }, surface: null } },
    ],
  },
  team: { five_hour: null, seven_day: null, seven_day_opus: null, extra_usage: null },
  teamWithWindows: {
    five_hour: { utilization: 14, resets_at: '2026-11-16T15:00:00+00:00' },
    seven_day: { utilization: 6, resets_at: '2026-11-21T09:00:00+00:00' },
  },
  limitsOnly: {
    limits: [
      { kind: 'session', percent: 19, resets_at: '2026-11-16T15:00:00+00:00', scope: null },
      { kind: 'weekly_all', percent: 27, resets_at: '2026-11-21T09:00:00+00:00', scope: null },
      { kind: 'weekly_all', percent: 99, resets_at: null, scope: { surface: { display_name: 'Cowork' } } },
    ],
  },
  future: {
    five_hour: { utilization: 5, resets_at: '2026-11-16T15:00:00+00:00', burn_rate: { per_hour: 3 } },
    seven_day: { utilization: 6, resets_at: '2026-11-21T09:00:00+00:00' },
    monthly: { utilization: 44, resets_at: '2026-12-01T00:00:00+00:00' },
    organization: { seats: 12 },
    schema_version: 9,
    notices: ['hello'],
  },
};

test('every plan shape parses into exactly the windows the API returned', () => {
  const pro = parseUsageResponse(JSON.stringify(PLAN_BODIES.pro));
  assert.deepEqual(pro.five_hour, { used_percentage: 31, resets_at: '2026-11-16T15:00:00.497+00:00' });
  assert.deepEqual(pro.seven_day, { used_percentage: 12, resets_at: '2026-11-21T09:00:00.120+00:00' });
  assert.deepEqual(pro.model_scoped, []);
  assert.deepEqual(pro.extra_usage, { enabled: false, utilization: null, used: null, limit: null });

  const max5x = parseUsageResponse(JSON.stringify(PLAN_BODIES.max5x));
  assert.equal(max5x.five_hour.used_percentage, 8.5);
  assert.deepEqual(max5x.model_scoped, [
    { display_name: 'Opus', utilization: 55, resets_at: '2026-11-21T09:00:00+00:00' },
    { display_name: 'Sonnet', utilization: 3, resets_at: '2026-11-21T09:00:00+00:00' },
  ]);
  assert.deepEqual(max5x.extra_usage, { enabled: true, utilization: 24.68, used: 1234, limit: 5000 });

  const weeklyOnly = parseUsageResponse(JSON.stringify(PLAN_BODIES.max20xWeeklyOnly));
  assert.deepEqual(weeklyOnly.five_hour, { used_percentage: null, resets_at: null }, 'no 5h window: none is invented');
  assert.equal(weeklyOnly.seven_day.used_percentage, 61);
  assert.deepEqual(weeklyOnly.model_scoped.map((w) => [w.display_name, w.utilization]), [['Fable', 9], ['Opus', 70]], 'Opus is listed once');

  const team = parseUsageResponse(JSON.stringify(PLAN_BODIES.team));
  assert.deepEqual(team, {
    five_hour: { used_percentage: null, resets_at: null },
    seven_day: { used_percentage: null, resets_at: null },
  });
  assert.equal(parseUsageResponse(JSON.stringify(PLAN_BODIES.teamWithWindows)).five_hour.used_percentage, 14);

  const limitsOnly = parseUsageResponse(JSON.stringify(PLAN_BODIES.limitsOnly));
  assert.deepEqual(limitsOnly.five_hour, { used_percentage: 19, resets_at: '2026-11-16T15:00:00+00:00' });
  assert.deepEqual(limitsOnly.seven_day, { used_percentage: 27, resets_at: '2026-11-21T09:00:00+00:00' });

  const future = parseUsageResponse(JSON.stringify(PLAN_BODIES.future));
  assert.deepEqual(future, {
    five_hour: { used_percentage: 5, resets_at: '2026-11-16T15:00:00+00:00' },
    seven_day: { used_percentage: 6, resets_at: '2026-11-21T09:00:00+00:00' },
  });

  const odd = parseUsageResponse(JSON.stringify({ five_hour: { utilization: '25', resets_at: 12345 }, seven_day: [], seven_day_opus: 'x', extra_usage: 'x', limits: 'x' }));
  assert.deepEqual(odd, { five_hour: { used_percentage: null, resets_at: null }, seven_day: { used_percentage: null, resets_at: null } });
});

const PROMO_BUCKETS = Object.fromEntries(
  ['seven_day_oauth_apps', 'seven_day_cowork', 'iguana_necktie', 'promo_weekend', 'promo_launch'].map((key) => [key, null]),
);
const bucket = (utilization, resets_at) => ({ utilization, resets_at, limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null });
const EXTRA_OFF = {
  is_enabled: false,
  monthly_limit: null,
  used_credits: null,
  utilization: null,
  currency: 'USD',
  decimal_places: 2,
  disabled_reason: 'user_disabled',
  user_disabled: true,
  spend_limit_reached: false,
  credits_ever_enabled: false,
  daily: null,
  weekly: null,
};
const row = (kind, percent, resets_at, model, is_active = true) => ({
  kind,
  group: kind === 'session' ? 'session' : 'weekly',
  percent,
  severity: 'normal',
  resets_at,
  scope: model ? { model: { id: null, display_name: model }, surface: null } : null,
  is_active,
});
const PROBED = {
  personalMax20x: {
    five_hour: null,
    seven_day: bucket(61.5, '2026-11-21T09:00:00.497000+00:00'),
    seven_day_opus: null,
    seven_day_sonnet: null,
    ...PROMO_BUCKETS,
    extra_usage: EXTRA_OFF,
    limits: [
      row('weekly_all', 61.5, '2026-11-21T09:00:00.497000+00:00', null),
      row('weekly_scoped', 4, '2026-11-21T10:00:00+00:00', 'Sonnet', false),
      row('weekly_scoped', 30, '2026-11-21T10:00:00+00:00', 'Fable', true),
    ],
  },
  teamMax5x: {
    five_hour: bucket(14.25, '2026-11-16T15:00:00.120000+00:00'),
    seven_day: bucket(6, '2026-11-21T09:00:00+00:00'),
    seven_day_opus: null,
    seven_day_sonnet: null,
    ...PROMO_BUCKETS,
    extra_usage: EXTRA_OFF,
    limits: [
      row('session', 14.25, '2026-11-16T15:00:00.120000+00:00', null),
      row('weekly_all', 6, '2026-11-21T09:00:00+00:00', null),
      row('weekly_scoped', 2, '2026-11-21T10:00:00+00:00', 'Fable', false),
      row('weekly_scoped', 9, '2026-11-21T10:00:00+00:00', 'Opus', false),
    ],
  },
};

test('the two probed account shapes parse as the API sent them', () => {
  const personal = parseUsageResponse(JSON.stringify(PROBED.personalMax20x));
  assert.deepEqual(personal.five_hour, { used_percentage: null, resets_at: null }, 'five_hour: null stays absent');
  assert.deepEqual(personal.seven_day, { used_percentage: 61.5, resets_at: '2026-11-21T09:00:00.497000+00:00' });
  assert.deepEqual(personal.model_scoped, [{ display_name: 'Fable', utilization: 30, resets_at: '2026-11-21T10:00:00+00:00' }], 'the active model row only');
  assert.deepEqual(personal.extra_usage, { enabled: false, utilization: null, used: null, limit: null, currency: 'USD', decimals: 2 });
  assert.equal(Object.keys(personal).some((key) => key.startsWith('promo') || key.includes('cowork')), false, 'promo and surface buckets are ignored');

  const team = parseUsageResponse(JSON.stringify(PROBED.teamMax5x));
  assert.deepEqual(team.five_hour, { used_percentage: 14.25, resets_at: '2026-11-16T15:00:00.120000+00:00' });
  assert.equal(team.seven_day.used_percentage, 6);
  assert.deepEqual(team.model_scoped, [{ display_name: 'Opus', utilization: 9, resets_at: '2026-11-21T10:00:00+00:00' }], 'no active model row: the fullest one');

  const fallback = parseUsageResponse(JSON.stringify({ ...PROBED.teamMax5x, limits: [row('session', 14, null, null)], seven_day_opus: bucket(55, null), seven_day_sonnet: bucket(3, null), seven_day_cowork: bucket(80, null) }));
  assert.deepEqual(fallback.model_scoped.map((w) => [w.display_name, w.utilization]), [['Opus', 55], ['Sonnet', 3]], 'model buckets are the fallback, surface buckets never');
});

test('extra usage is read from either shape the API may send', () => {
  const read = (extra_usage) => parseUsageResponse(JSON.stringify({ seven_day: bucket(1, null), extra_usage })).extra_usage;
  assert.deepEqual(read({ ...EXTRA_OFF, is_enabled: true, monthly_limit: 5000, used_credits: 1240, utilization: 24.8 }), { enabled: true, utilization: 24.8, used: 1240, limit: 5000, currency: 'USD', decimals: 2 });
  assert.deepEqual(read({ ...EXTRA_OFF, is_enabled: true, monthly_limit: 5000, used_credits: 5000, utilization: 100, spend_limit_reached: true }).reached, true);
  assert.deepEqual(
    read({ enabled: true, percent: 12.5, spend: { used: { amount_minor: 625, currency: 'EUR', exponent: 2 }, limit: { amount_minor: 5000, currency: 'EUR', exponent: 2 } } }),
    { enabled: true, utilization: 12.5, used: 625, limit: 5000, currency: 'EUR', decimals: 2 },
  );
  assert.deepEqual(read({ enabled: true, cap: 9000, spend: { used: { amount_minor: 1, currency: 'JPY', exponent: 0 } } }), { enabled: true, utilization: null, used: 1, limit: 9000, currency: 'JPY', decimals: 0 });
  assert.deepEqual(read({ is_enabled: true, monthly_limit: '5000', used_credits: [], decimal_places: 99, currency: 7 }), { enabled: true, utilization: null, used: null, limit: null });
  assert.equal(read(null), undefined);
  assert.equal(read('on'), undefined);
});

test('each HTTP answer is classified without reading the plan label', () => {
  const ok = classifyResponse(200, JSON.stringify(PLAN_BODIES.pro), null, NOW);
  assert.equal(ok.kind, 'ok');
  assert.equal(classifyResponse(200, JSON.stringify(PLAN_BODIES.team), null, NOW).kind, 'ok', 'null personal windows are an answer, not an error');
  assert.deepEqual(classifyResponse(401, '', null, NOW), { kind: 'auth_expired' });
  assert.deepEqual(classifyResponse(403, '', null, NOW), { kind: 'forbidden' });
  assert.deepEqual(classifyResponse(429, '', '90', NOW), { kind: 'rate_limited', retryAfterMs: 90_000 });
  assert.deepEqual(classifyResponse(429, '', new Date(NOW + 45_000).toUTCString(), NOW), { kind: 'rate_limited', retryAfterMs: 45_000 });
  assert.deepEqual(classifyResponse(429, '', null, NOW), { kind: 'rate_limited', retryAfterMs: null });
  assert.deepEqual(classifyResponse(429, '', 'soon', NOW), { kind: 'rate_limited', retryAfterMs: null });
  assert.deepEqual(classifyResponse(500, '', null, NOW), { kind: 'error' });
  assert.deepEqual(classifyResponse(200, '<html>', null, NOW), { kind: 'error' });
  assert.deepEqual(classifyResponse(200, JSON.stringify({ error: { type: 'permission_error' } }), null, NOW), { kind: 'error' });
});

test('back-off honours Retry-After exactly and otherwise doubles from a minute to a cap, with jitter', () => {
  assert.equal(backoffMs('rate_limited', 1, 90_000, () => 1), 90_000, 'Retry-After is used as sent, with no jitter');
  assert.equal(backoffMs('rate_limited', 7, 1_000, () => 1), 1_000);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => backoffMs('rate_limited', n)), [1, 2, 4, 8, 15, 15].map((m) => m * 60_000));
  assert.equal(BACKOFF_RATE_LIMIT_MAX_MS, 15 * 60_000);
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => backoffMs('error', n)), [1, 2, 4, 8, 15].map((m) => m * 60_000));
  assert.equal(BACKOFF_ERROR_MAX_MS, 15 * 60_000);
  assert.deepEqual([1, 2, 3].map((n) => backoffMs('auth_expired', n)), [5, 5, 5].map((m) => m * 60_000));
  assert.deepEqual([1, 2, 3].map((n) => backoffMs('no_login', n)), [2, 4, 5].map((m) => m * 60_000));
  assert.equal(BACKOFF_AUTH_MAX_MS, 5 * 60_000);
  assert.deepEqual([1, 2, 3].map((n) => backoffMs('forbidden', n)), [1, 1, 1].map((h) => h * HOUR));
  assert.equal(BACKOFF_FORBIDDEN_MAX_MS, HOUR);
  assert.equal(BACKOFF_JITTER, 0.25);
  assert.equal(backoffMs('rate_limited', 1, null, () => 1), 75_000);
  assert.equal(backoffMs('rate_limited', 1, null, () => 0.5), 67_500);
  for (const roll of [0, 0.3, 0.999]) {
    const wait = backoffMs('error', 3, null, () => roll);
    assert.ok(wait >= 4 * 60_000 && wait <= 5 * 60_000, 'jitter only ever lengthens the wait');
  }
  assert.equal(backoffMs('error', 500), BACKOFF_ERROR_MAX_MS);
});

function poller(options = {}) {
  const homeDir = options.homeDir ?? newHome('poll');
  const snapshotPath = getSnapshotPath(homeDir);
  const shared = options.accountsDir ?? path.join(mkdtempSync(path.join(testRoot, 'accounts-')), 'accounts');
  const state = { now: options.now ?? NOW, calls: [], answers: options.answers ?? [], token: 'token' in options ? options.token : 'fake-token' };
  const run = () =>
    refreshUsage({
      now: () => state.now,
      random: options.random ?? (() => 0),
      snapshotPath,
      readToken: () => state.token,
      fetchUsage: async (token, userAgent) => {
        state.calls.push({ token, userAgent });
        const next = state.answers.shift() ?? { status: 200, body: PLAN_BODIES.pro };
        return classifyResponse(next.status, JSON.stringify(next.body ?? {}), next.retryAfter ?? null, state.now);
      },
      userAgent: async () => 'claude-code/test',
      accountKey: 'accountKey' in options ? options.accountKey : 'acct-one',
      accountsDir: shared,
      isAlive: options.isAlive,
    });
  return { homeDir, snapshotPath, accountsDir: shared, state, run, disk: () => readSnapshot(snapshotPath) };
}

test('a successful poll stamps every window with when it was seen', async () => {
  const p = poller({ answers: [{ status: 200, body: PLAN_BODIES.max20xWeeklyOnly }] });
  assert.equal(await p.run(), 'ok');
  const disk = p.disk();
  assert.equal(p.state.calls.length, 1);
  assert.equal(p.state.calls[0].userAgent, 'claude-code/test');
  assert.deepEqual(disk.five_hour, { used_percentage: null, resets_at: null, seen_at: ISO(NOW) }, 'the missing 5h window is recorded as missing');
  assert.equal(disk.seven_day.used_percentage, 61);
  assert.equal(disk.seven_day.seen_at, ISO(NOW));
  assert.equal(disk.status, 'ok');
  assert.equal(disk.failure_count, 0);
  assert.equal(disk.extra_usage.limit, 20000);
  assert.deepEqual(disk.model_scoped.map((w) => w.display_name), ['Fable', 'Opus']);
  assert.equal(await p.run(), 'fresh', 'nothing is requested while the reading is fresh');
  assert.equal(p.state.calls.length, 1);
});

test('429: Retry-After is honoured to the second, the display keeps its values, the next success clears it', async () => {
  const p = poller({ answers: [{ status: 200, body: PLAN_BODIES.pro }, { status: 429, retryAfter: '90' }, { status: 429 }, { status: 429 }, { status: 200, body: PLAN_BODIES.pro }], random: () => 1 });
  await p.run();
  p.state.now = NOW + USAGE_TTL_MS + 1_000;
  assert.equal(await p.run(), 'rate_limited');
  let disk = p.disk();
  assert.equal(disk.status, 'rate_limited');
  assert.equal(disk.next_attempt_at, ISO(p.state.now + 90_000));
  assert.equal(disk.five_hour.used_percentage, 31, 'the last reading is kept');
  assert.equal(disk.oauth_updated_at, ISO(NOW));
  assert.equal(disk.failure_count, 1);

  p.state.now += 60_000;
  assert.equal(await p.run(), 'fresh', 'still inside the window the server asked for');
  assert.equal(p.state.calls.length, 2);

  p.state.now += 30_000;
  assert.equal(await p.run(), 'rate_limited');
  disk = p.disk();
  assert.equal(disk.failure_count, 2);
  assert.equal(disk.next_attempt_at, ISO(p.state.now + Math.round(2 * 60_000 * (1 + BACKOFF_JITTER))), 'no header: doubled and jittered');

  p.state.now = Date.parse(disk.next_attempt_at);
  assert.equal(await p.run(), 'rate_limited');
  assert.equal(p.disk().failure_count, 3);
  assert.equal(p.disk().next_attempt_at, ISO(p.state.now + Math.round(4 * 60_000 * (1 + BACKOFF_JITTER))));

  p.state.now = Date.parse(p.disk().next_attempt_at);
  assert.equal(await p.run(), 'ok');
  disk = p.disk();
  assert.equal(disk.status, 'ok');
  assert.equal(disk.next_attempt_at, null);
  assert.equal(disk.failure_count, 0);
  assert.equal(p.state.calls.length, 5);
});

test('403 on a Team or Enterprise account stops the polling without marking the data broken', async () => {
  const p = poller({ answers: [{ status: 403 }, { status: 403 }] });
  writeFileSync(p.snapshotPath, JSON.stringify(snap({ updated_at: ISO(NOW - 2 * USAGE_TTL_MS), oauth_updated_at: null, source: 'stdin' })));
  assert.equal(await p.run(), 'forbidden');
  let disk = p.disk();
  assert.equal(disk.status, 'ok', 'stdin readings are not flagged stale because the endpoint is closed');
  assert.equal(disk.five_hour.used_percentage, 50, 'the stdin windows stay');
  assert.equal(disk.next_attempt_at, ISO(NOW + BACKOFF_FORBIDDEN_MS));
  for (const later of [60_000, 10 * 60_000, 59 * 60_000]) {
    p.state.now = NOW + later;
    assert.equal(await p.run(), 'fresh');
  }
  assert.equal(p.state.calls.length, 1, 'one request an hour, not one every few minutes');
  const shown = resolveUsage(stdin({ fiveHour: 66 }), true, { now: () => NOW + 30 * 60_000, homeDir: p.homeDir, fs: defaultSnapshotFs, spawnRefresher: () => assert.fail('no poll during the pause'), stdinSeenAt: NOW + 30 * 60_000 });
  assert.equal(shown.fiveHour, 66, 'stdin keeps driving the bars');
  assert.equal(shown.staleSince, undefined);
  p.state.now = NOW + BACKOFF_FORBIDDEN_MS + 1_000;
  assert.equal(await p.run(), 'forbidden');
  assert.equal(p.disk().next_attempt_at, ISO(p.state.now + BACKOFF_FORBIDDEN_MS), 'and again an hour later, never sooner');
  assert.equal(p.state.calls.length, 2);
});

test('a Team account answering with null windows falls back to stdin and never loops', async () => {
  const p = poller({ answers: [{ status: 200, body: PLAN_BODIES.team }] });
  assert.equal(await p.run(), 'ok');
  assert.equal(p.disk().status, 'ok');
  assert.equal(p.disk().next_attempt_at, null);
  const deps = { now: () => NOW + 5_000, homeDir: p.homeDir, fs: defaultSnapshotFs, spawnRefresher: () => assert.fail('the reading is fresh') };
  const shown = resolveUsage(stdin({ fiveHour: 21, sevenDay: 4 }), true, { ...deps, stdinSeenAt: NOW - HOUR });
  assert.equal(shown.fiveHour, 21);
  assert.equal(shown.sevenDay, 4);
  assert.equal(resolveUsage(null, true, deps).fiveHour, null, 'with no stdin either there is nothing to show, and nothing is made up');
});

test('errors, an expired login and a missing login each back off on their own curve', async () => {
  const p = poller({ answers: [{ status: 500 }, { status: 502 }, { status: 401 }] });
  assert.equal(await p.run(), 'error');
  assert.equal(p.disk().status, 'error');
  assert.equal(p.disk().next_attempt_at, ISO(NOW + BACKOFF_ERROR_MS));
  assert.deepEqual(p.disk().five_hour, { used_percentage: null, resets_at: null });
  p.state.now = NOW + BACKOFF_ERROR_MS;
  assert.equal(await p.run(), 'error');
  assert.equal(p.disk().next_attempt_at, ISO(p.state.now + 2 * BACKOFF_ERROR_MS));
  p.state.now += 2 * BACKOFF_ERROR_MS;
  assert.equal(await p.run(), 'auth_expired');
  assert.equal(p.disk().status, 'auth_expired');
  assert.equal(p.disk().next_attempt_at, ISO(p.state.now + BACKOFF_AUTH_MS), 'a rejected token waits five minutes');

  const loggedOut = poller({ token: null });
  assert.equal(await loggedOut.run(), 'no-token');
  assert.equal(loggedOut.state.calls.length, 0, 'no token: no request at all');
  assert.equal(loggedOut.disk().status, 'auth_expired');
  assert.equal(loggedOut.disk().next_attempt_at, ISO(NOW + BACKOFF_NO_LOGIN_MS));
  loggedOut.state.now = NOW + BACKOFF_NO_LOGIN_MS;
  await loggedOut.run();
  loggedOut.state.now += 2 * BACKOFF_NO_LOGIN_MS;
  await loggedOut.run();
  assert.equal(loggedOut.disk().next_attempt_at, ISO(loggedOut.state.now + BACKOFF_AUTH_MAX_MS), 'a login is noticed within five minutes');
  loggedOut.state.token = 'fake-token';
  loggedOut.state.now += BACKOFF_AUTH_MAX_MS;
  assert.equal(await loggedOut.run(), 'ok');
  assert.equal(loggedOut.disk().failure_count, 0);
});

test('two profiles on one account share a single request; different accounts never share', async () => {
  const shared = path.join(mkdtempSync(path.join(testRoot, 'accounts-')), 'accounts');
  const personal = poller({ accountsDir: shared, accountKey: 'acct-personal', answers: [{ status: 200, body: PLAN_BODIES.max5x }] });
  const second = poller({ accountsDir: shared, accountKey: 'acct-personal', answers: [{ status: 200, body: PLAN_BODIES.pro }] });
  const team = poller({ accountsDir: shared, accountKey: 'acct-team', answers: [{ status: 200, body: PLAN_BODIES.teamWithWindows }] });

  assert.equal(await personal.run(), 'ok');
  second.state.now = NOW + 20_000;
  assert.equal(await second.run(), 'shared');
  assert.equal(second.state.calls.length, 0, 'the second profile of the same account makes no request');
  assert.equal(second.disk().five_hour.used_percentage, 8.5);
  assert.equal(second.disk().five_hour.seen_at, ISO(NOW), 'and keeps the time the reading was really taken');
  assert.equal(second.disk().oauth_updated_at, ISO(NOW));

  team.state.now = NOW + 20_000;
  assert.equal(await team.run(), 'ok');
  assert.equal(team.state.calls.length, 1, 'another account polls for itself');
  assert.equal(team.disk().five_hour.used_percentage, 14);
  assert.equal(personal.disk().five_hour.used_percentage, 8.5, 'and never overwrites the first account');

  second.state.now = NOW + USAGE_TTL_MS + 5_000;
  second.state.answers = [{ status: 200, body: PLAN_BODIES.pro }];
  assert.equal(await second.run(), 'ok', 'past the TTL whoever asks first does the one request');
  assert.equal(second.state.calls.length, 1);
  personal.state.now = NOW + USAGE_TTL_MS + 9_000;
  assert.equal(await personal.run(), 'shared');
  assert.equal(personal.state.calls.length, 1);
  assert.equal(personal.disk().five_hour.used_percentage, 31);

  const unknownA = poller({ accountsDir: shared, accountKey: null });
  const unknownB = poller({ accountsDir: shared, accountKey: null });
  await unknownA.run();
  await unknownB.run();
  assert.equal(unknownA.state.calls.length + unknownB.state.calls.length, 2, 'profiles with no known account are never merged');
});

test('a 429 for the account pauses its other profile too, and only that account', async () => {
  const shared = path.join(mkdtempSync(path.join(testRoot, 'accounts-')), 'accounts');
  const first = poller({ accountsDir: shared, accountKey: 'acct-a', answers: [{ status: 429, retryAfter: '600' }] });
  const sibling = poller({ accountsDir: shared, accountKey: 'acct-a' });
  const other = poller({ accountsDir: shared, accountKey: 'acct-b' });
  writeFileSync(sibling.snapshotPath, JSON.stringify(snap({ updated_at: ISO(NOW - 2 * USAGE_TTL_MS), oauth_updated_at: ISO(NOW - 2 * USAGE_TTL_MS) })));

  assert.equal(await first.run(), 'rate_limited');
  sibling.state.now = NOW + 30_000;
  assert.equal(await sibling.run(), 'backing-off');
  assert.equal(sibling.state.calls.length, 0);
  assert.equal(sibling.disk().next_attempt_at, ISO(NOW + 600_000), 'the sibling waits until the same moment');
  assert.equal(sibling.disk().five_hour.used_percentage, 50, 'and keeps its values on screen');
  assert.equal(await other.run(), 'ok');
  assert.equal(other.state.calls.length, 1);
});

test('one request per account at a time, and a crashed holder does not block the next', async () => {
  const shared = path.join(mkdtempSync(path.join(testRoot, 'accounts-')), 'accounts');
  mkdirSync(shared, { recursive: true });
  const lock = path.join(shared, '.acct-x.lock');
  writeFileSync(lock, '4242');
  const busy = poller({ accountsDir: shared, accountKey: 'acct-x', isAlive: () => true });
  assert.equal(await busy.run(), 'busy');
  assert.equal(busy.state.calls.length, 0);
  assert.equal(busy.disk(), null, 'a busy account writes nothing: the next repaint asks again');

  const after = poller({ accountsDir: shared, accountKey: 'acct-x', isAlive: () => false });
  assert.equal(await after.run(), 'ok');
  assert.equal(after.state.calls.length, 1);
  assert.equal(existsSync(lock), false, 'the lock is released after the request');
});

test('the account key comes from the profile\'s own login and the shared folder sits outside every profile', () => {
  const home = mkdtempSync(path.join(testRoot, 'acct-home-'));
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  assert.equal(readAccountKey(home), null);
  writeFileSync(path.join(home, '.claude', '.claude.json'), JSON.stringify({ migrationVersion: 1 }));
  writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'user-1', organizationUuid: 'org-1' } }));
  const key = readAccountKey(home);
  assert.match(key, /^[0-9a-f]{24}$/);
  assert.ok(!key.includes('user-1'));
  writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'user-1', organizationUuid: 'org-2' } }));
  assert.notEqual(readAccountKey(home), key, 'the same person in another organisation is another account');
  writeFileSync(path.join(home, '.claude.json'), '{ broken');
  assert.equal(readAccountKey(home), null);

  const dir = accountsDir(home, {});
  assert.ok(dir.startsWith(home));
  assert.ok(!dir.includes(`${path.sep}.claude${path.sep}`));
  assert.equal(accountsDir(home, { XDG_CACHE_HOME: path.join(home, 'xdg'), LOCALAPPDATA: path.join(home, 'xdg') }), path.join(home, 'xdg', 'claude-hud-enhanced', 'accounts'));
});
