import type { HourCycleMode, TimeFormatMode } from '../config.js';
import { interpolate, t } from '../i18n/index.js';

/** Options controlling how wall-clock time is rendered. */
export interface WallClockOptions {
  hourCycle: HourCycleMode;
  showSeconds: boolean;
}

const DEFAULT_WALL_CLOCK_OPTIONS: WallClockOptions = { hourCycle: 'auto', showSeconds: false };

/**
 * Formats a usage-window reset timestamp for display in the HUD.
 *
 * @param resetAt - The reset timestamp, or null if unknown.
 * @param mode    - How to express the time:
 *   - `'relative'` (default) — duration until reset, e.g. `2h 30m`
 *   - `'absolute'`           — wall-clock time,       e.g. `at 14:30` (locale-aware)
 *   - `'both'`               — both combined,          e.g. `2h 30m, at 14:30` (locale-aware)
 * @param opts    - Wall-clock rendering options (hourCycle, showSeconds); defaults preserve existing behavior.
 * @returns A formatted string, or an empty string when the reset is in the past
 *          or the date is unknown.
 */
export function formatResetTime(
  resetAt: Date | null,
  mode: TimeFormatMode = 'relative',
  windowScale: 'short' | 'long' = 'long',
  opts: WallClockOptions = DEFAULT_WALL_CLOCK_OPTIONS,
): string {
  if (!resetAt) return '';

  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  if (mode === 'relative') {
    return formatRelative(diffMs);
  }

  const absolute = formatAbsolute(resetAt, now, windowScale, opts);

  if (mode === 'absolute') {
    return absolute;
  }

  // 'both' — comma separator avoids nested parentheses when the caller
  // wraps the result in its own (...) parenthetical
  return `${formatRelative(diffMs)}, ${absolute}`;
}

function formatRelative(diffMs: number): string {
  const diffMins = Math.ceil(diffMs / 60000);

  if (diffMins < 60) {
    return `${diffMins}m`;
  }

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatAbsolute(
  resetAt: Date,
  now: Date,
  windowScale: 'short' | 'long',
  opts: WallClockOptions,
): string {
  // Locale "format.absoluteTime" wraps the value (en/zh both "{time}" — bare).
  //
  // `hour: 'numeric'` is this fork's look ("9:33 PM", not "09:33 PM"), so the
  // default path is unchanged for existing users. An explicit hourCycle or
  // seconds switches to '2-digit': a fixed 24-hour clock only reads
  // unambiguously zero-padded ("09:33", "00:05"), which is also what upstream's
  // h23/h24 tests assert.
  const explicitClock = opts.hourCycle !== 'auto' || opts.showSeconds;
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: explicitClock ? '2-digit' : 'numeric',
    minute: '2-digit',
  };
  if (opts.showSeconds) timeOpts.second = '2-digit';
  if (opts.hourCycle !== 'auto') timeOpts.hourCycle = opts.hourCycle;
  const timeStr = resetAt.toLocaleTimeString([], timeOpts);

  // Short windows (e.g. the 5-hour limit) are always imminent, so the date is
  // noise — show just the clock time ("3:20 AM"), even across a midnight roll.
  if (windowScale === 'short') {
    return interpolate(t('format.absoluteTime'), { time: timeStr });
  }

  // Long windows (the weekly quota) always name the day they reset on
  // ("Sat 3:00 AM") — including later today — since a weekly reset is far
  // clearer with its weekday. A weekly window resets every 7 days, so allow a
  // little slack (~8 days) before falling back to a month/day, which is only
  // reached by unusually distant windows where a bare weekday would be ambiguous.
  const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
  if (resetAt.getTime() - now.getTime() < EIGHT_DAYS_MS) {
    const weekday = resetAt.toLocaleDateString([], { weekday: 'short' });
    return interpolate(t('format.absoluteTime'), { time: `${weekday} ${timeStr}` });
  }

  const dateStr = resetAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return interpolate(t('format.absoluteTime'), { time: `${dateStr} ${timeStr}` });
}
