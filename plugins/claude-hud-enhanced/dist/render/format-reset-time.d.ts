import type { HourCycleMode, TimeFormatMode } from '../config.js';
/** Options controlling how wall-clock time is rendered. */
export interface WallClockOptions {
    hourCycle: HourCycleMode;
    showSeconds: boolean;
}
/** Joins windows that share one reset, which is then printed once at the group's end. */
export declare const SHARED_RESET_JOINER = " \u00B7 ";
/**
 * True when two windows reset in the same minute, so they would print the same
 * reset time. The API stamps the weekly window 16:59:59.631 and the Fable window
 * 17:00:00 for the same boundary, so exact equality would never match.
 */
export declare function sameResetMinute(a: Date | null, b: Date | null): boolean;
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
export declare function formatResetTime(resetAt: Date | null, mode?: TimeFormatMode, windowScale?: 'short' | 'long', opts?: WallClockOptions): string;
/**
 * Renders a timestamp as wall-clock time, adding a date component when it falls
 * on a different calendar day than `now`.
 *
 * Exported for the prompt-cache line, which shows an expiry instant rather than
 * a usage window and so has no short/long window scale to apply.
 *
 * @param resetAt - The timestamp to render.
 * @param now     - Reference for the same-day check.
 * @param opts    - Wall-clock rendering options (hourCycle, showSeconds).
 */
export declare function formatAbsoluteTime(resetAt: Date, now: Date, opts?: WallClockOptions): string;
//# sourceMappingURL=format-reset-time.d.ts.map