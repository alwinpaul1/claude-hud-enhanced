import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResetTime } from '../dist/render/format-reset-time.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a Date that is `ms` milliseconds in the future. */
function future(ms) {
  return new Date(Date.now() + ms);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Null / past guard
// ---------------------------------------------------------------------------

test('returns empty string for null', () => {
  assert.equal(formatResetTime(null), '');
  assert.equal(formatResetTime(null, 'absolute'), '');
  assert.equal(formatResetTime(null, 'both'), '');
});

test('returns empty string for a date in the past', () => {
  const past = new Date(Date.now() - HOUR);
  assert.equal(formatResetTime(past), '');
  assert.equal(formatResetTime(past, 'absolute'), '');
  assert.equal(formatResetTime(past, 'both'), '');
});

// ---------------------------------------------------------------------------
// relative mode (default)
// ---------------------------------------------------------------------------

test('relative: shows minutes when < 1 hour', () => {
  const result = formatResetTime(future(30 * MINUTE));
  assert.match(result, /^\d+m$/);
});

test('relative: shows hours + minutes when < 24 hours', () => {
  const result = formatResetTime(future(2 * HOUR + 30 * MINUTE));
  assert.match(result, /^2h 30m$/);
});

test('relative: shows hours only when minutes == 0', () => {
  // Exactly N hours: Math.ceil(N*60 mins) = N*60 → mins % 60 === 0
  const result = formatResetTime(future(3 * HOUR));
  assert.match(result, /^3h$/);
});

test('relative: shows days + hours for durations >= 24 hours', () => {
  const result = formatResetTime(future(6 * DAY + 7 * HOUR));
  assert.match(result, /^6d 7h$/);
});

test('relative: shows days only when remaining hours == 0', () => {
  // Exactly N days → hours % 24 === 0
  const result = formatResetTime(future(3 * DAY));
  assert.match(result, /^3d$/);
});

test('relative: is the default when mode is omitted', () => {
  const withDefault = formatResetTime(future(90 * MINUTE));
  const withExplicit = formatResetTime(future(90 * MINUTE), 'relative');
  // Both should match the same pattern (values may differ by a few ms)
  assert.match(withDefault, /^\d+h( \d+m)?$/);
  assert.match(withExplicit, /^\d+h( \d+m)?$/);
});

// ---------------------------------------------------------------------------
// absolute mode
// ---------------------------------------------------------------------------

test('absolute: returns a bare clock time with no "at" prefix', () => {
  const result = formatResetTime(future(2 * HOUR), 'absolute', 'short');
  assert.ok(!result.startsWith('at '), `Expected no "at " prefix, got: ${result}`);
  assert.ok(result.length > 0, `Expected a non-empty absolute string, got: ${result}`);
});

test('absolute long window: names the weekday even for a same-day reset', () => {
  // A weekly reset later today should still show its weekday, not collapse to time-only.
  const resetAt = future(2 * HOUR); // same calendar day (usually)
  const result = formatResetTime(resetAt, 'absolute', 'long');
  const expectedWeekday = resetAt.toLocaleDateString([], { weekday: 'short' });
  assert.ok(result.includes(expectedWeekday), `Expected weekday for a long window, got: ${result}`);
});

test('absolute short window: time-only even across a day boundary', () => {
  const resetAt = future(30 * HOUR); // different calendar day, but a short (5h-style) window
  const result = formatResetTime(resetAt, 'absolute', 'short');
  const expectedTime = resetAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  assert.equal(result, expectedTime, `Expected time-only for a short window, got: ${result}`);
});

test('absolute long window: weekday + time within the coming week', () => {
  const resetAt = future(30 * HOUR); // different calendar day, within 7 days
  const result = formatResetTime(resetAt, 'absolute', 'long');
  const expectedWeekday = resetAt.toLocaleDateString([], { weekday: 'short' });
  const expectedTime = resetAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  assert.ok(!result.startsWith('at '), `Expected no "at " prefix, got: ${result}`);
  assert.ok(result.includes(expectedWeekday), `Expected weekday in within-week reset, got: ${result}`);
  assert.ok(result.endsWith(expectedTime), `Expected localized time, got: ${result}`);
});

test('absolute long window: month/day + time beyond a week', () => {
  const resetAt = future(10 * 24 * HOUR); // > 7 days out
  const result = formatResetTime(resetAt, 'absolute', 'long');
  const expectedDate = resetAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const expectedTime = resetAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  assert.ok(result.includes(expectedDate), `Expected month/day beyond a week, got: ${result}`);
  assert.ok(result.endsWith(expectedTime), `Expected localized time, got: ${result}`);
});

// ---------------------------------------------------------------------------
// both mode
// ---------------------------------------------------------------------------

test('both: contains the relative duration', () => {
  const result = formatResetTime(future(2 * HOUR + 30 * MINUTE), 'both');
  assert.match(result, /2h 30m/);
});

test('both: contains the absolute part after a comma', () => {
  const result = formatResetTime(future(2 * HOUR), 'both');
  assert.match(result, /, .+/);
  assert.ok(!result.includes(', at '), `Expected no "at" prefix, got: ${result}`);
});

test('both: format is "<relative>, <absolute>"', () => {
  const result = formatResetTime(future(2 * HOUR), 'both');
  // e.g. "2h, 14:30" — comma avoids nested parens when caller wraps in (...)
  assert.match(result, /^\d+h( \d+m)?, .+$/);
});

// ---------------------------------------------------------------------------
// config integration — mergeConfig accepts and validates timeFormat
// ---------------------------------------------------------------------------

test('mergeConfig defaults timeFormat to "absolute"', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({});
  assert.equal(config.display.timeFormat, 'absolute');
});

test('mergeConfig accepts "absolute" timeFormat', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { timeFormat: 'absolute' } });
  assert.equal(config.display.timeFormat, 'absolute');
});

test('mergeConfig accepts "both" timeFormat', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { timeFormat: 'both' } });
  assert.equal(config.display.timeFormat, 'both');
});

test('mergeConfig rejects invalid timeFormat and falls back to "absolute"', async () => {
  const { mergeConfig } = await import('../dist/config.js');
  const config = mergeConfig({ display: { timeFormat: 'invalid-value' } });
  assert.equal(config.display.timeFormat, 'absolute');
});
