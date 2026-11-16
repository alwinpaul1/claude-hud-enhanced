import type { RenderContext, ScopedUsageWindow } from "../../types.js";
import { isLimitReached } from "../../types.js";
import type { MessageKey } from "../../i18n/types.js";
import { shouldHideUsage } from "../../stdin.js";
import { critical, label, quotaBar, warning, type QuotaTone } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import {
  progressLabel,
  type ProgressLabelInput,
} from "./label-align.js";
import { formatRelativeTime } from "./session-time.js";
import type { TimeFormatMode, UsageValueMode } from "../../config.js";
import { formatResetTime, sameResetMinute, type WallClockOptions } from "../format-reset-time.js";
import { activeExtraSpend, formatExtraSpend, formatUsageFigure, hasAgeNote, usageNote, type ExtraDetail } from "../usage-figure.js";
import { firstFitting, type Fits } from "../visual.js";
import { hasFigure } from "../../usage-available.js";

const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "⚠ stale (1d 9h ago)": says the usage numbers beside it are a last-known
 * reading the OAuth poll has failed to refresh, and how old that reading is.
 * Shared by the expanded usage line and the compact session line.
 */
export function formatStaleUsageMarker(
  staleSince: Date,
  colors?: RenderContext["config"]["colors"],
  now: number = Date.now(),
): string {
  const age = formatRelativeTime(now - staleSince.getTime());
  return warning(`⚠ ${t("status.stale")} (${age})`, colors);
}

interface UsageLineStyle {
  bars: boolean;
  resetLabel: boolean;
  compact: boolean;
  resetTimes: boolean;
  notes: boolean;
  extra: ExtraDetail;
}

export function renderUsageLine(
  ctx: RenderContext,
  labelOptions: ProgressLabelInput = {},
  fits?: Fits,
): string | null {
  const display = ctx.config?.display;
  const style: UsageLineStyle = {
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

  const plain: UsageLineStyle = { ...style, bars: false, resetLabel: false };
  const steps: UsageLineStyle[] = [
    { ...style, bars: false },
    plain,
    { ...plain, resetTimes: false },
    { ...plain, resetTimes: false, notes: false },
    { ...plain, resetTimes: false, notes: false, extra: 'short' },
  ];
  return firstFitting(steps.map((step) => () => renderStyledUsageLine(ctx, labelOptions, step) ?? full), fits);
}

function renderStyledUsageLine(
  ctx: RenderContext,
  labelOptions: ProgressLabelInput,
  style: UsageLineStyle,
): string | null {
  const line = renderUsageBody(ctx, labelOptions, style);
  const usage = ctx.usageData;
  const staleSince = usage?.staleSince;
  return line && usage && staleSince && !hasAgeNote(usage)
    ? `${line} | ${formatStaleUsageMarker(staleSince, ctx.config?.colors)}`
    : line;
}

function renderUsageBody(
  ctx: RenderContext,
  labelOptions: ProgressLabelInput,
  style: UsageLineStyle,
): string | null {
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
  const wallClockOpts: WallClockOptions = {
    hourCycle: display?.hourCycle ?? 'auto',
    showSeconds: display?.showClockSeconds ?? false,
  };
  const showResetLabel = style.resetLabel;
  const resetsKey = limitResetTimeFormat(timeFormat) === 'absolute' ? "format.resets" : "format.resetsIn";
  const usageCompact = style.compact;
  const usageValueMode = display?.usageValue ?? 'percent';
  const barWidth = getAdaptiveBarWidth();
  const resetAtOf = (resetAt: Date | null): Date | null => (style.resetTimes ? resetAt : null);
  const windowPart = (spec: {
    label: string;
    compactLabel?: string;
    labelKey?: MessageKey;
    percent: number;
    resetAt: Date | null;
    windowMs: number;
    note?: string | null;
    tone?: QuotaTone;
    forceLabel?: boolean;
  }): string =>
    usageCompact
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
  const scopedPart = (w: ScopedUsageWindow, anchorResetAt: Date | null): string =>
    windowPart({
      label: w.label,
      percent: w.percent ?? 0,
      resetAt: sameResetMinute(w.resetAt, anchorResetAt) ? null : w.resetAt,
      windowMs: SEVEN_DAY_WINDOW_MS,
      tone: 'model',
    });
  const finish = (parts: string[], isLabelled: boolean): string | null => {
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
  const effectiveUsage = Math.max(
    fiveHour ?? 0,
    sevenDay ?? 0,
    ...scopedWindows.map((window) => window.percent ?? 0),
  );
  if (effectiveUsage < threshold) {
    return balanceLabel ? `${usageLabel} ${balanceLabel}` : null;
  }

  const sevenDayThreshold = display?.sevenDayThreshold ?? 0;
  const showSevenDay = sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold);
  const anchorResetAt = showSevenDay ? usage.sevenDayResetAt : null;
  const windows: string[] = [];
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

function appendBalance(line: string, balanceLabel: string | null): string {
  return balanceLabel ? `${line} | ${balanceLabel}` : line;
}

interface WindowPartOptions {
  label: string;
  percent: number;
  resetAt: Date | null;
  windowMs: number;
  timeFormat: TimeFormatMode;
  colors?: RenderContext["config"]["colors"];
  usageValueMode: UsageValueMode;
  wallClockOpts?: WallClockOptions;
  note: string | null;
  showNote: boolean;
  tone?: QuotaTone;
}

function formatCompactWindowPart(options: WindowPartOptions): string {
  const { label: windowLabel, percent, resetAt, windowMs, timeFormat, colors, usageValueMode, wallClockOpts, note, showNote, tone } = options;
  const usageDisplay = formatUsageFigure(percent, { colors, mode: usageValueMode, note, showNote, tone });
  const reset = formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset
    ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
    : `${styledLabel} ${usageDisplay}`;
}

function formatUsageWindowPart(
  options: WindowPartOptions & {
    labelKey?: MessageKey;
    usageBarEnabled: boolean;
    barWidth: number;
    showResetLabel: boolean;
    forceLabel: boolean;
    labelOptions: ProgressLabelInput;
  },
): string {
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

function normalizeTimeFormat(value: unknown): TimeFormatMode {
  if (
    value === 'absolute'
    || value === 'both'
    || value === 'elapsed'
    || value === 'elapsedAndAbsolute'
  ) {
    return value;
  }

  return 'relative';
}

function limitResetTimeFormat(timeFormat: TimeFormatMode): 'relative' | 'absolute' | 'both' {
  if (timeFormat === 'elapsedAndAbsolute') {
    return 'absolute';
  }

  if (timeFormat === 'elapsed') {
    return 'relative';
  }

  return timeFormat;
}

function formatWindowTime(
  resetAt: Date | null,
  windowMs: number,
  timeFormat: TimeFormatMode,
  wallClockOpts?: WallClockOptions,
): string {
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

function formatElapsedWindow(resetAt: Date | null, windowMs: number): string {
  if (!resetAt) {
    return '';
  }

  const windowStart = resetAt.getTime() - windowMs;
  const rawElapsed = ((Date.now() - windowStart) / windowMs) * 100;
  const elapsed = Math.max(0, Math.min(100, Math.round(rawElapsed)));
  return `${elapsed}% elapsed`;
}
