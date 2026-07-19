import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAccessToken,
  parseUsageResponse,
  parseRetryAfterMs,
  successSnapshot,
  failureSnapshot,
} from '../dist/refresh-usage.js';
import { USAGE_TTL_MS } from '../dist/usage-hybrid.js';

const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);
const ISO = (ms) => new Date(ms).toISOString();

// --- parseAccessToken ---

test('parseAccessToken extracts claudeAiOauth.accessToken', () => {
  const raw = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-abc' } });
  assert.equal(parseAccessToken(raw), 'sk-ant-oat-abc');
});

test('parseAccessToken returns null for missing/empty token and bad JSON', () => {
  assert.equal(parseAccessToken(JSON.stringify({ claudeAiOauth: {} })), null);
  assert.equal(parseAccessToken(JSON.stringify({ claudeAiOauth: { accessToken: '' } })), null);
  assert.equal(parseAccessToken(JSON.stringify({ claudeAiOauth: { accessToken: 42 } })), null);
  assert.equal(parseAccessToken(JSON.stringify({})), null);
  assert.equal(parseAccessToken('not json'), null);
});

// --- parseUsageResponse ---

test('parseUsageResponse maps five_hour/seven_day buckets', () => {
  const body = JSON.stringify({
    five_hour: { utilization: 25, resets_at: '2026-07-19T15:00:00Z' },
    seven_day: { utilization: 60.5, resets_at: '2026-07-23T00:00:00Z' },
  });
  assert.deepEqual(parseUsageResponse(body), {
    five_hour: { used_percentage: 25, resets_at: '2026-07-19T15:00:00Z' },
    seven_day: { used_percentage: 60.5, resets_at: '2026-07-23T00:00:00Z' },
  });
});

test('parseUsageResponse treats a null bucket as 0% with no reset (Enterprise)', () => {
  const body = JSON.stringify({ five_hour: null, seven_day: { utilization: 10, resets_at: null } });
  assert.deepEqual(parseUsageResponse(body), {
    five_hour: { used_percentage: 0, resets_at: null },
    seven_day: { used_percentage: 10, resets_at: null },
  });
});

test('parseUsageResponse fills a missing bucket with nulls when the other exists', () => {
  const body = JSON.stringify({ five_hour: { utilization: 5, resets_at: null } });
  assert.deepEqual(parseUsageResponse(body), {
    five_hour: { used_percentage: 5, resets_at: null },
    seven_day: { used_percentage: null, resets_at: null },
  });
});

test('parseUsageResponse rejects bodies with no usable window', () => {
  assert.equal(parseUsageResponse(JSON.stringify({})), null);
  assert.equal(parseUsageResponse(JSON.stringify({ five_hour: 'nope' })), null);
  assert.equal(parseUsageResponse('not json'), null);
  assert.equal(parseUsageResponse(JSON.stringify(null)), null);
});

test('parseUsageResponse nulls non-numeric utilization / non-string resets_at', () => {
  const body = JSON.stringify({ five_hour: { utilization: '25', resets_at: 12345 } });
  assert.deepEqual(parseUsageResponse(body), {
    five_hour: { used_percentage: null, resets_at: null },
    seven_day: { used_percentage: null, resets_at: null },
  });
});

// --- parseRetryAfterMs ---

test('parseRetryAfterMs parses delta-seconds', () => {
  assert.equal(parseRetryAfterMs('120', NOW), 120_000);
  assert.equal(parseRetryAfterMs('0', NOW), null);
});

test('parseRetryAfterMs parses an HTTP-date relative to now', () => {
  assert.equal(parseRetryAfterMs(new Date(NOW + 90_000).toUTCString(), NOW), 90_000);
  // A date in the past is unusable
  assert.equal(parseRetryAfterMs(new Date(NOW - 1000).toUTCString(), NOW), null);
});

test('parseRetryAfterMs returns null for absent/garbage headers', () => {
  assert.equal(parseRetryAfterMs(null, NOW), null);
  assert.equal(parseRetryAfterMs('', NOW), null);
  assert.equal(parseRetryAfterMs('soon', NOW), null);
});

// --- successSnapshot ---

test('successSnapshot stamps updated_at=now, source=oauth, clears backoff', () => {
  const windows = {
    five_hour: { used_percentage: 25, resets_at: ISO(NOW + 3_600_000) },
    seven_day: { used_percentage: 60, resets_at: ISO(NOW + 3 * 86_400_000) },
  };
  assert.deepEqual(successSnapshot(windows, NOW), {
    updated_at: ISO(NOW),
    source: 'oauth',
    ...windows,
    status: 'ok',
    next_attempt_at: null,
  });
});

// --- failureSnapshot ---

const PREV = {
  updated_at: ISO(NOW - 10 * 60_000),
  source: 'stdin',
  five_hour: { used_percentage: 40, resets_at: ISO(NOW + 3_600_000) },
  seven_day: { used_percentage: 70, resets_at: ISO(NOW + 86_400_000) },
  status: 'ok',
  next_attempt_at: null,
};

test('failureSnapshot preserves last-good values and does NOT bump updated_at', () => {
  const snap = failureSnapshot(PREV, 'error', NOW);
  assert.equal(snap.updated_at, PREV.updated_at);
  assert.equal(snap.source, PREV.source);
  assert.deepEqual(snap.five_hour, PREV.five_hour);
  assert.deepEqual(snap.seven_day, PREV.seven_day);
  assert.equal(snap.status, 'error');
});

test('failureSnapshot backoff: error ~5min, auth_expired ~30min', () => {
  assert.equal(failureSnapshot(PREV, 'error', NOW).next_attempt_at, ISO(NOW + 5 * 60_000));
  assert.equal(failureSnapshot(PREV, 'auth_expired', NOW).next_attempt_at, ISO(NOW + 30 * 60_000));
});

test('failureSnapshot backoff: 429 honors Retry-After, else 2×TTL', () => {
  assert.equal(
    failureSnapshot(PREV, 'rate_limited', NOW, 300_000).next_attempt_at,
    ISO(NOW + 300_000),
  );
  assert.equal(
    failureSnapshot(PREV, 'rate_limited', NOW, null).next_attempt_at,
    ISO(NOW + 2 * USAGE_TTL_MS),
  );
});

test('failureSnapshot with no previous snapshot writes null windows and epoch updated_at', () => {
  const snap = failureSnapshot(null, 'error', NOW);
  assert.equal(snap.updated_at, ISO(0)); // ages out immediately once backoff clears
  assert.equal(snap.source, 'oauth');
  assert.deepEqual(snap.five_hour, { used_percentage: null, resets_at: null });
  assert.deepEqual(snap.seven_day, { used_percentage: null, resets_at: null });
});
