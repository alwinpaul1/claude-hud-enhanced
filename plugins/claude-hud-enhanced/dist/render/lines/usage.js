import { isLimitReached } from "../../types.js";
import { shouldHideUsage } from "../../stdin.js";
import { critical, label, quotaBar, warning } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import { progressLabel, } from "./label-align.js";
import { formatRelativeTime } from "./session-time.js";
import { formatResetTime, sameResetMinute } from "../format-reset-time.js";
import { activeExtraSpend, formatExtraSpend, formatUsageFigure, hasAgeNote, usageNote } from "../usage-figure.js";
import { firstFitting } from "../visual.js";
import { hasFigure } from "../../usage-available.js";
const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * "⚠ stale (1d 9h ago)": says the usage numbers beside it are a last-known
 * reading the OAuth poll has failed to refresh, and how old that reading is.
 * Shared by the expanded usage line and the compact session line.
 */
export function formatStaleUsageMarker(staleSince, colors, now = Date.now()) {
    const age = formatRelativeTime(now - staleSince.getTime());
    return warning(`⚠ ${t("status.stale")} (${age})`, colors);
}
export function renderUsageLine(ctx, labelOptions = {}, fits) {
    const display = ctx.config?.display;
    const style = {
        bars: display?.usageBarEnabled ?? true,
        resetLabel: display?.showResetLabel ?? true,
        compact: display?.usageCompact ?? false,
        resetTimes: true,
        notes: true,
        extra: 'full',
    };
    const full = renderStyledUsageLine(ctx, labelOptions, style);
    if (full === null || !fits || fits(full)) {
        return full;
    }
    const plain = { ...style, bars: false, resetLabel: false };
    const steps = [
        { ...style, bars: false },
        plain,
        { ...plain, resetTimes: false },
        { ...plain, resetTimes: false, notes: false },
        { ...plain, resetTimes: false, notes: false, extra: 'short' },
    ];
    return firstFitting(steps.map((step) => () => renderStyledUsageLine(ctx, labelOptions, step) ?? full), fits);
}
function renderStyledUsageLine(ctx, labelOptions, style) {
    const line = renderUsageBody(ctx, labelOptions, style);
    const usage = ctx.usageData;
    const staleSince = usage?.staleSince;
    return line && usage && staleSince && !hasAgeNote(usage)
        ? `${line} | ${formatStaleUsageMarker(staleSince, ctx.config?.colors)}`
        : line;
}
function renderUsageBody(ctx, labelOptions, style) {
    const display = ctx.config?.display;
    const colors = ctx.config?.colors;
    const usage = ctx.usageData;
    if (display?.showUsage === false || !usage || shouldHideUsage(ctx.stdin)) {
        return null;
    }
    const usageLabel = progressLabel("label.usage", colors, labelOptions);
    const spend = activeExtraSpend(usage);
    const balanceLabel = usage.balanceLabel ?? (spend ? formatExtraSpend(spend, colors, style.extra) : null);
    const scopedWindows = (usage.scopedWindows ?? []).filter((w) => hasFigure(w.percent));
    const fiveHour = hasFigure(usage.fiveHour) ? usage.fiveHour : null;
    const sevenDay = hasFigure(usage.sevenDay) ? usage.sevenDay : null;
    const hasWindowData = fiveHour !== null || sevenDay !== null || scopedWindows.length > 0;
    if (!hasWindowData) {
        return balanceLabel ? `${usageLabel} ${balanceLabel}` : null;
    }
    const timeFormat = normalizeTimeFormat(display?.timeFormat);
    const wallClockOpts = {
        hourCycle: display?.hourCycle ?? 'auto',
        showSeconds: display?.showClockSeconds ?? false,
    };
    const showResetLabel = style.resetLabel;
    const resetsKey = limitResetTimeFormat(timeFormat) === 'absolute' ? "format.resets" : "format.resetsIn";
    const usageCompact = style.compact;
    const usageValueMode = display?.usageValue ?? 'percent';
    const barWidth = getAdaptiveBarWidth();
    const resetAtOf = (resetAt) => (style.resetTimes ? resetAt : null);
    const windowPart = (spec) => usageCompact
        ? formatCompactWindowPart({
            label: spec.compactLabel ?? spec.label,
            percent: spec.percent,
            resetAt: resetAtOf(spec.resetAt),
            windowMs: spec.windowMs,
            timeFormat,
            colors,
            usageValueMode,
            wallClockOpts,
            note: spec.note ?? null,
            showNote: style.notes,
            tone: spec.tone,
        })
        : formatUsageWindowPart({
            label: spec.label,
            labelKey: spec.labelKey,
            percent: spec.percent,
            resetAt: resetAtOf(spec.resetAt),
            windowMs: spec.windowMs,
            colors,
            usageBarEnabled: style.bars,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: spec.forceLabel ?? true,
            labelOptions,
            usageValueMode,
            wallClockOpts,
            note: spec.note ?? null,
            showNote: style.notes,
            tone: spec.tone,
        });
    const scopedPart = (w, anchorResetAt) => windowPart({
        label: w.label,
        percent: w.percent ?? 0,
        resetAt: sameResetMinute(w.resetAt, anchorResetAt) ? null : w.resetAt,
        windowMs: SEVEN_DAY_WINDOW_MS,
        tone: 'model',
    });
    const finish = (parts, isLabelled) => {
        if (parts.length === 0) {
            return balanceLabel ? `${usageLabel} ${balanceLabel}` : null;
        }
        const line = parts.join(' | ');
        return appendBalance(isLabelled ? `${usageLabel} ${line}` : line, balanceLabel);
    };
    if (isLimitReached(usage)) {
        const limitTimeFormat = limitResetTimeFormat(timeFormat);
        const fiveHourLimit = usage.fiveHour === 100;
        const limitResetAt = fiveHourLimit ? usage.fiveHourResetAt : usage.sevenDayResetAt;
        const resetTime = formatResetTime(resetAtOf(limitResetAt), limitTimeFormat, fiveHourLimit ? 'short' : 'long', wallClockOpts);
        const resetSuffix = resetTime
            ? showResetLabel && !usageCompact
                ? ` (${t(resetsKey)} ${resetTime})`
                : ` (${resetTime})`
            : "";
        const limitPart = critical(`⚠ ${usageCompact ? 'Limit' : t("status.limitReached")}${resetSuffix}`, colors);
        return finish([limitPart, ...scopedWindows.map((w) => scopedPart(w, limitResetAt))], !usageCompact);
    }
    const threshold = display?.usageThreshold ?? 0;
    const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0, ...scopedWindows.map((window) => window.percent ?? 0));
    if (effectiveUsage < threshold) {
        return balanceLabel ? `${usageLabel} ${balanceLabel}` : null;
    }
    const sevenDayThreshold = display?.sevenDayThreshold ?? 0;
    const showSevenDay = sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold);
    const anchorResetAt = showSevenDay ? usage.sevenDayResetAt : null;
    const windows = [];
    if (fiveHour !== null) {
        windows.push(windowPart({
            label: "5h",
            percent: fiveHour,
            resetAt: usage.fiveHourResetAt,
            windowMs: FIVE_HOUR_WINDOW_MS,
            note: usageNote(usage, 'fiveHour'),
            forceLabel: false,
        }));
    }
    scopedWindows.forEach((w) => windows.push(scopedPart(w, anchorResetAt)));
    if (showSevenDay && sevenDay !== null) {
        windows.push(windowPart({
            label: t("label.weekly"),
            compactLabel: "7d",
            labelKey: "label.weekly",
            percent: sevenDay,
            resetAt: usage.sevenDayResetAt,
            windowMs: SEVEN_DAY_WINDOW_MS,
            note: usageNote(usage, 'sevenDay'),
        }));
    }
    return finish(windows, !usageCompact);
}
function appendBalance(line, balanceLabel) {
    return balanceLabel ? `${line} | ${balanceLabel}` : line;
}
function formatCompactWindowPart(options) {
    const { label: windowLabel, percent, resetAt, windowMs, timeFormat, colors, usageValueMode, wallClockOpts, note, showNote, tone } = options;
    const usageDisplay = formatUsageFigure(percent, { colors, mode: usageValueMode, note, showNote, tone });
    const reset = formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts);
    const styledLabel = label(`${windowLabel}:`, colors);
    return reset
        ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
        : `${styledLabel} ${usageDisplay}`;
}
function formatUsageWindowPart(options) {
    const { label: windowLabel, labelKey, percent, resetAt, windowMs, colors, usageBarEnabled, barWidth, timeFormat, showResetLabel, forceLabel, labelOptions, usageValueMode, wallClockOpts, note, showNote, tone } = options;
    const usageDisplay = formatUsageFigure(percent, { colors, mode: usageValueMode, note, showNote, tone });
    const reset = formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts);
    const styledLabel = labelKey
        ? progressLabel(labelKey, colors, labelOptions)
        : label(windowLabel, colors);
    const showResetWording = timeFormat !== 'elapsed' && timeFormat !== 'elapsedAndAbsolute';
    const resetsKey = timeFormat === 'absolute' ? "format.resets" : "format.resetsIn";
    const resetSuffix = reset
        ? label(showResetLabel && showResetWording ? `(${t(resetsKey)} ${reset})` : `(${reset})`, colors)
        : "";
    if (usageBarEnabled) {
        const bar = quotaBar(percent, barWidth, colors, tone);
        const body = resetSuffix
            ? `${bar} ${usageDisplay} ${resetSuffix}`
            : `${bar} ${usageDisplay}`;
        return forceLabel ? `${styledLabel} ${body}` : body;
    }
    return resetSuffix
        ? `${styledLabel} ${usageDisplay} ${resetSuffix}`
        : `${styledLabel} ${usageDisplay}`;
}
function normalizeTimeFormat(value) {
    if (value === 'absolute'
        || value === 'both'
        || value === 'elapsed'
        || value === 'elapsedAndAbsolute') {
        return value;
    }
    return 'relative';
}
function limitResetTimeFormat(timeFormat) {
    if (timeFormat === 'elapsedAndAbsolute') {
        return 'absolute';
    }
    if (timeFormat === 'elapsed') {
        return 'relative';
    }
    return timeFormat;
}
function formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts) {
    // 5-hour windows are always imminent → clock time only; longer windows get
    // weekday/date context. See formatAbsolute in format-reset-time.ts.
    const scale = windowMs <= FIVE_HOUR_WINDOW_MS ? 'short' : 'long';
    if (timeFormat === 'elapsed') {
        return formatElapsedWindow(resetAt, windowMs);
    }
    if (timeFormat === 'elapsedAndAbsolute') {
        const elapsed = formatElapsedWindow(resetAt, windowMs);
        const absolute = formatResetTime(resetAt, 'absolute', scale, wallClockOpts);
        if (elapsed && absolute) {
            return `${elapsed}, ${absolute}`;
        }
        return elapsed || absolute;
    }
    return formatResetTime(resetAt, timeFormat, scale, wallClockOpts);
}
function formatElapsedWindow(resetAt, windowMs) {
    if (!resetAt) {
        return '';
    }
    const windowStart = resetAt.getTime() - windowMs;
    const rawElapsed = ((Date.now() - windowStart) / windowMs) * 100;
    const elapsed = Math.max(0, Math.min(100, Math.round(rawElapsed)));
    return `${elapsed}% elapsed`;
}
//# sourceMappingURL=usage.js.map