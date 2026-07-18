import type { UsageData } from './types.js';

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Advance a passed reset timestamp forward by whole window lengths until it is
 * in the future (the window may have rolled over more than once while idle).
 */
function rollForward(resetAt: Date, now: number, windowMs: number): Date {
  const start = resetAt.getTime();
  if (windowMs <= 0 || start > now) {
    return resetAt;
  }
  const windowsBehind = Math.floor((now - start) / windowMs) + 1;
  return new Date(start + windowsBehind * windowMs);
}

/**
 * Local idle reset detection (no network).
 *
 * The HUD only receives fresh `rate_limits` on stdin when the user sends a
 * message — Claude Code refreshes them from the API response. Between messages
 * the numbers are frozen. The one thing that legitimately changes while idle is
 * a usage window *rolling over* at its reset time: the user's own usage on this
 * machine can't rise without a message, so once a window's `resets_at` has
 * passed, its true usage is ~0%.
 *
 * This reflects that locally: for any window whose reset time is now in the
 * past, zero the percentage and roll `resets_at` forward to the next occurrence.
 * Windows whose reset is still in the future are untouched (a message would have
 * refreshed them with a future reset). A `null` percentage stays `null`.
 *
 * Scope line: this only zeroes on rollover. It does not reflect usage burned by
 * *other* devices/sessions while this machine is idle, and the percentage
 * between resets remains the last stdin snapshot. Local-only by design.
 */
export function applyIdleUsageReset(
  usage: UsageData | null,
  now: number = Date.now(),
): UsageData | null {
  if (!usage) {
    return usage;
  }

  let changed = false;
  const next: UsageData = { ...usage };

  if (usage.fiveHourResetAt && usage.fiveHourResetAt.getTime() <= now) {
    next.fiveHour = usage.fiveHour === null ? null : 0;
    next.fiveHourResetAt = rollForward(usage.fiveHourResetAt, now, FIVE_HOUR_MS);
    changed = true;
  }

  if (usage.sevenDayResetAt && usage.sevenDayResetAt.getTime() <= now) {
    next.sevenDay = usage.sevenDay === null ? null : 0;
    next.sevenDayResetAt = rollForward(usage.sevenDayResetAt, now, SEVEN_DAY_MS);
    changed = true;
  }

  if (usage.scopedWindows && usage.scopedWindows.length > 0) {
    let scopedChanged = false;
    const scoped = usage.scopedWindows.map((window) => {
      if (window.resetAt && window.resetAt.getTime() <= now) {
        scopedChanged = true;
        return {
          ...window,
          percent: window.percent === null ? null : 0,
          resetAt: rollForward(window.resetAt, now, SEVEN_DAY_MS),
        };
      }
      return window;
    });
    if (scopedChanged) {
      next.scopedWindows = scoped;
      changed = true;
    }
  }

  return changed ? next : usage;
}
