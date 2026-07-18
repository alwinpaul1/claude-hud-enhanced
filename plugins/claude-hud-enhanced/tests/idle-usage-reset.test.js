import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIdleUsageReset } from '../dist/idle-usage-reset.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 6, 18, 12, 0, 0); // fixed clock

test('null usage passes through', () => {
  assert.equal(applyIdleUsageReset(null, NOW), null);
});

test('future reset windows are untouched (same object)', () => {
  const usage = {
    fiveHour: 80,
    sevenDay: 40,
    fiveHourResetAt: new Date(NOW + 2 * HOUR),
    sevenDayResetAt: new Date(NOW + 3 * DAY),
  };
  const out = applyIdleUsageReset(usage, NOW);
  assert.equal(out, usage); // unchanged reference when nothing rolled over
  assert.equal(out.fiveHour, 80);
});

test('a 5h window whose reset passed is zeroed and rolled forward', () => {
  const resetAt = new Date(NOW - 30 * 60 * 1000); // reset 30m ago
  const out = applyIdleUsageReset(
    { fiveHour: 99, sevenDay: 40, fiveHourResetAt: resetAt, sevenDayResetAt: new Date(NOW + 3 * DAY) },
    NOW,
  );
  assert.equal(out.fiveHour, 0, 'usage zeroed after rollover');
  assert.ok(out.fiveHourResetAt.getTime() > NOW, 'reset rolled into the future');
  // next reset = original + one 5h window
  assert.equal(out.fiveHourResetAt.getTime(), resetAt.getTime() + 5 * HOUR);
  assert.equal(out.sevenDay, 40, 'untouched weekly stays');
});

test('rolls forward across multiple missed windows', () => {
  const resetAt = new Date(NOW - 12 * HOUR); // 12h ago → two 5h windows passed
  const out = applyIdleUsageReset(
    { fiveHour: 99, sevenDay: null, fiveHourResetAt: resetAt, sevenDayResetAt: null },
    NOW,
  );
  assert.equal(out.fiveHour, 0);
  assert.ok(out.fiveHourResetAt.getTime() > NOW);
  // 12h behind, 5h window → advance 3 windows (15h) → 3h in the future
  assert.equal(out.fiveHourResetAt.getTime(), resetAt.getTime() + 3 * 5 * HOUR);
});

test('weekly window rollover zeroes and rolls by 7 days', () => {
  const resetAt = new Date(NOW - HOUR);
  const out = applyIdleUsageReset(
    { fiveHour: 20, sevenDay: 88, fiveHourResetAt: new Date(NOW + HOUR), sevenDayResetAt: resetAt },
    NOW,
  );
  assert.equal(out.sevenDay, 0);
  assert.equal(out.sevenDayResetAt.getTime(), resetAt.getTime() + 7 * DAY);
  assert.equal(out.fiveHour, 20, 'future 5h untouched');
});

test('null percentage stays null on rollover (only reset rolls)', () => {
  const resetAt = new Date(NOW - HOUR);
  const out = applyIdleUsageReset(
    { fiveHour: null, sevenDay: 40, fiveHourResetAt: resetAt, sevenDayResetAt: new Date(NOW + DAY) },
    NOW,
  );
  assert.equal(out.fiveHour, null);
  assert.ok(out.fiveHourResetAt.getTime() > NOW);
});

test('scoped weekly windows roll over independently', () => {
  const past = new Date(NOW - HOUR);
  const future = new Date(NOW + DAY);
  const out = applyIdleUsageReset(
    {
      fiveHour: null,
      sevenDay: null,
      fiveHourResetAt: null,
      sevenDayResetAt: null,
      scopedWindows: [
        { label: 'Fable', percent: 90, resetAt: past },
        { label: 'Opus', percent: 30, resetAt: future },
      ],
    },
    NOW,
  );
  assert.equal(out.scopedWindows[0].percent, 0, 'passed scoped window zeroed');
  assert.equal(out.scopedWindows[0].resetAt.getTime(), past.getTime() + 7 * DAY);
  assert.equal(out.scopedWindows[1].percent, 30, 'future scoped window untouched');
});
