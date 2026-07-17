import { interpolate, t } from '../i18n/index.js';
/**
 * Formats a usage-window reset timestamp for display in the HUD.
 *
 * @param resetAt - The reset timestamp, or null if unknown.
 * @param mode    - How to express the time:
 *   - `'relative'` (default) — duration until reset, e.g. `2h 30m`
 *   - `'absolute'`           — wall-clock time,       e.g. `at 14:30` (locale-aware)
 *   - `'both'`               — both combined,          e.g. `2h 30m, at 14:30` (locale-aware)
 * @returns A formatted string, or an empty string when the reset is in the past
 *          or the date is unknown.
 */
export function formatResetTime(resetAt, mode = 'relative', windowScale = 'long') {
    if (!resetAt)
        return '';
    const now = new Date();
    const diffMs = resetAt.getTime() - now.getTime();
    if (diffMs <= 0)
        return '';
    if (mode === 'relative') {
        return formatRelative(diffMs);
    }
    const absolute = formatAbsolute(resetAt, now, windowScale);
    if (mode === 'absolute') {
        return absolute;
    }
    // 'both' — comma separator avoids nested parentheses when the caller
    // wraps the result in its own (...) parenthetical
    return `${formatRelative(diffMs)}, ${absolute}`;
}
function formatRelative(diffMs) {
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
function formatAbsolute(resetAt, now, windowScale) {
    // Locale "format.absoluteTime" wraps the value (en/zh both "{time}" — bare).
    const timeStr = resetAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    // Short windows (e.g. the 5-hour limit) are always imminent, so the date is
    // noise — show just the clock time ("3:20 AM"), even across a midnight roll.
    // Long windows show the clock time when the reset is today, a weekday when it
    // lands within the coming week ("Sat 3:00 AM"), and a month/day beyond that.
    if (windowScale === 'short' || resetAt.toDateString() === now.toDateString()) {
        return interpolate(t('format.absoluteTime'), { time: timeStr });
    }
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (resetAt.getTime() - now.getTime() < WEEK_MS) {
        const weekday = resetAt.toLocaleDateString([], { weekday: 'short' });
        return interpolate(t('format.absoluteTime'), { time: `${weekday} ${timeStr}` });
    }
    const dateStr = resetAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return interpolate(t('format.absoluteTime'), { time: `${dateStr} ${timeStr}` });
}
//# sourceMappingURL=format-reset-time.js.map