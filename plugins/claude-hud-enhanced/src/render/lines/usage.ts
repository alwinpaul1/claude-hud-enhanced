import type { RenderContext, ScopedUsageWindow } from "../../types.js";
import { isLimitReached } from "../../types.js";
import type { MessageKey } from "../../i18n/types.js";
import { shouldHideUsage } from "../../stdin.js";
import { critical, label, getQuotaColor, quotaBar, warning, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";
import {
  progressLabel,
  type ProgressLabelInput,
} from "./label-align.js";
import { formatRelativeTime } from "./session-time.js";
import type { TimeFormatMode, UsageValueMode } from "../../config.js";
import { formatResetTime, sameResetMinute, SHARED_RESET_JOINER, type WallClockOptions } from "../format-reset-time.js";

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

export function renderUsageLine(
  ctx: RenderContext,
  labelOptions: ProgressLabelInput = {},
): string | null {
  const line = renderUsageBody(ctx, labelOptions);
  const staleSince = ctx.usageData?.staleSince;
  return line && staleSince
    ? `${line} | ${formatStaleUsageMarker(staleSince, ctx.config?.colors)}`
    : line;
}

function renderUsageBody(
  ctx: RenderContext,
  labelOptions: ProgressLabelInput,
): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData) {
    return null;
  }

  if (shouldHideUsage(ctx.stdin)) {
    return null;
  }

  const usageLabel = progressLabel("label.usage", colors, labelOptions);
  const balanceLabel = ctx.usageData.balanceLabel ?? null;
  const scopedWindows = ctx.usageData.scopedWindows ?? [];
  const hasWindowData = ctx.usageData.fiveHour !== null
    || ctx.usageData.sevenDay !== null
    || scopedWindows.length > 0;

  if (balanceLabel && !hasWindowData) {
    return `${usageLabel} ${balanceLabel}`;
  }

  const timeFormat = normalizeTimeFormat(display?.timeFormat);
  const wallClockOpts: WallClockOptions = {
    hourCycle: display?.hourCycle ?? 'auto',
    showSeconds: display?.showClockSeconds ?? false,
  };
  const showResetLabel = display?.showResetLabel ?? true;
  const resetsKey = limitResetTimeFormat(timeFormat) === 'absolute' ? "format.resets" : "format.resetsIn";
  const usageCompact = display?.usageCompact ?? false;
  const usageValueMode = display?.usageValue ?? 'percent';
  const barWidthForScoped = getAdaptiveBarWidth();
  const scopedPart = (w: ScopedUsageWindow, withReset = true): string =>
    usageCompact
      ? formatCompactWindowPart(w.label, w.percent, withReset ? w.resetAt : null, SEVEN_DAY_WINDOW_MS, timeFormat, colors, usageValueMode, wallClockOpts)
      : formatUsageWindowPart({
          label: w.label,
          percent: w.percent,
          resetAt: withReset ? w.resetAt : null,
          windowMs: SEVEN_DAY_WINDOW_MS,
          colors,
          usageBarEnabled: display?.usageBarEnabled ?? true,
          barWidth: barWidthForScoped,
          timeFormat,
          showResetLabel,
          forceLabel: true,
          labelOptions,
          usageValueMode,
          wallClockOpts,
        });
  const suffixOf = (windows: ScopedUsageWindow[]): string =>
    windows.length ? ' | ' + windows.map((w) => scopedPart(w)).join(' | ') : '';
  const scopedSuffix = suffixOf(scopedWindows);

  // The weekly window plus every scoped window. Those that reset in the same
  // minute as the weekly one (Fable does) join it as one " · " group that prints
  // the shared reset once, at the end; the rest keep their own.
  const withScoped = (renderWeekly: (withReset: boolean) => string): string => {
    const weeklyResetAt = ctx.usageData?.sevenDayResetAt ?? null;
    const shared = scopedWindows.filter((w) => sameResetMinute(w.resetAt, weeklyResetAt));
    if (shared.length === 0) {
      return `${renderWeekly(true)}${scopedSuffix}`;
    }
    const group = [
      renderWeekly(false),
      ...shared.map((w, index) => scopedPart(w, index === shared.length - 1)),
    ].join(SHARED_RESET_JOINER);
    return `${group}${suffixOf(scopedWindows.filter((w) => !shared.includes(w)))}`;
  };

  if (isLimitReached(ctx.usageData)) {
    const limitTimeFormat = limitResetTimeFormat(timeFormat);
    const resetTime =
      ctx.usageData.fiveHour === 100
        ? formatResetTime(ctx.usageData.fiveHourResetAt, limitTimeFormat, 'short', wallClockOpts)
        : formatResetTime(ctx.usageData.sevenDayResetAt, limitTimeFormat, 'long', wallClockOpts);
    if (usageCompact) {
      return appendBalance(`${critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ""}`, colors)}${scopedSuffix}`, balanceLabel);
    }
    const resetSuffix = resetTime
      ? showResetLabel
        ? ` (${t(resetsKey)} ${resetTime})`
        : ` (${resetTime})`
      : "";
    return appendBalance(`${usageLabel} ${critical(`⚠ ${t("status.limitReached")}${resetSuffix}`, colors)}${scopedSuffix}`, balanceLabel);
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;

  const effectiveUsage = Math.max(
    fiveHour ?? 0,
    sevenDay ?? 0,
    ...scopedWindows.map((window) => window.percent ?? 0),
  );
  if (effectiveUsage < threshold) {
    return balanceLabel ? `${usageLabel} ${balanceLabel}` : null;
  }

  const sevenDayThreshold = display?.sevenDayThreshold ?? 0;

  if (usageCompact) {
    const fiveHourPart = fiveHour !== null
      ? formatCompactWindowPart("5h", fiveHour, ctx.usageData.fiveHourResetAt, FIVE_HOUR_WINDOW_MS, timeFormat, colors, usageValueMode, wallClockOpts)
      : null;
    const sevenDayResetAt = ctx.usageData.sevenDayResetAt;
    const sevenDayWithScoped = (sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold))
      ? withScoped((withReset) => formatCompactWindowPart("7d", sevenDay, withReset ? sevenDayResetAt : null, SEVEN_DAY_WINDOW_MS, timeFormat, colors, usageValueMode, wallClockOpts))
      : null;

    if (fiveHourPart && sevenDayWithScoped) {
      return appendBalance(`${fiveHourPart} | ${sevenDayWithScoped}`, balanceLabel);
    }
    if (sevenDayWithScoped) {
      return appendBalance(sevenDayWithScoped, balanceLabel);
    }
    if (fiveHourPart) {
      return appendBalance(`${fiveHourPart}${scopedSuffix}`, balanceLabel);
    }
    return scopedSuffix ? appendBalance(scopedSuffix.slice(3), balanceLabel) : null;
  }

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const barWidth = getAdaptiveBarWidth();

  if (fiveHour === null && sevenDay === null) {
    return scopedSuffix
      ? appendBalance(`${usageLabel} ${scopedSuffix.slice(3)}`, balanceLabel)
      : balanceLabel
        ? `${usageLabel} ${balanceLabel}`
        : null;
  }

  if (fiveHour === null && sevenDay !== null) {
    const sevenDayResetAt = ctx.usageData.sevenDayResetAt;
    const weeklyOnlyPart = (withReset: boolean) => formatUsageWindowPart({
      label: t("label.weekly"),
      labelKey: "label.weekly",
      percent: sevenDay,
      resetAt: withReset ? sevenDayResetAt : null,
      windowMs: SEVEN_DAY_WINDOW_MS,
      colors,
      usageBarEnabled,
      barWidth,
      timeFormat,
      showResetLabel,
      forceLabel: true,
      labelOptions,
      usageValueMode,
      wallClockOpts,
    });
    return appendBalance(`${usageLabel} ${withScoped(weeklyOnlyPart)}`, balanceLabel);
  }

  const fiveHourPart = formatUsageWindowPart({
    label: "5h",
    percent: fiveHour,
    resetAt: ctx.usageData.fiveHourResetAt,
    windowMs: FIVE_HOUR_WINDOW_MS,
    colors,
    usageBarEnabled,
    barWidth,
    timeFormat,
    showResetLabel,
    usageValueMode,
    wallClockOpts,
  });

  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayResetAt = ctx.usageData.sevenDayResetAt;
    const sevenDayPart = (withReset: boolean) => formatUsageWindowPart({
      label: t("label.weekly"),
      labelKey: "label.weekly",
      percent: sevenDay,
      resetAt: withReset ? sevenDayResetAt : null,
      windowMs: SEVEN_DAY_WINDOW_MS,
      colors,
      usageBarEnabled,
      barWidth,
      timeFormat,
      showResetLabel,
      forceLabel: true,
      labelOptions,
      usageValueMode,
      wallClockOpts,
    });
    return appendBalance(`${usageLabel} ${fiveHourPart} | ${withScoped(sevenDayPart)}`, balanceLabel);
  }

  return appendBalance(`${usageLabel} ${fiveHourPart}${scopedSuffix}`, balanceLabel);
}

function appendBalance(line: string, balanceLabel: string | null): string {
  return balanceLabel ? `${line} | ${balanceLabel}` : line;
}

function formatCompactWindowPart(
  windowLabel: string,
  percent: number | null,
  resetAt: Date | null,
  windowMs: number,
  timeFormat: TimeFormatMode,
  colors?: RenderContext["config"]["colors"],
  usageValueMode: UsageValueMode = 'percent',
  wallClockOpts?: WallClockOptions,
): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset
    ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
    : `${styledLabel} ${usageDisplay}`;
}

function formatUsagePercent(
  percent: number | null,
  colors?: RenderContext["config"]["colors"],
  mode: UsageValueMode = 'percent',
): string {
  if (percent === null) {
    return label("--", colors);
  }
  const color = getQuotaColor(percent, colors);
  const displayPercent = mode === 'remaining' ? Math.max(0, 100 - percent) : percent;
  return `${color}${displayPercent}%${RESET}`;
}

function formatUsageWindowPart({
  label: windowLabel,
  labelKey,
  percent,
  resetAt,
  windowMs,
  colors,
  usageBarEnabled,
  barWidth,
  timeFormat = 'relative',
  showResetLabel,
  forceLabel = false,
  labelOptions = {},
  usageValueMode = 'percent',
  wallClockOpts,
}: {
  label: string;
  labelKey?: MessageKey;
  percent: number | null;
  resetAt: Date | null;
  windowMs: number;
  colors?: RenderContext["config"]["colors"];
  usageBarEnabled: boolean;
  barWidth: number;
  timeFormat?: TimeFormatMode;
  showResetLabel: boolean;
  forceLabel?: boolean;
  labelOptions?: ProgressLabelInput;
  usageValueMode?: UsageValueMode;
  wallClockOpts?: WallClockOptions;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatWindowTime(resetAt, windowMs, timeFormat, wallClockOpts);
  const styledLabel = labelKey
    ? progressLabel(labelKey, colors, labelOptions)
    : label(windowLabel, colors);
  const showResetWording = timeFormat !== 'elapsed' && timeFormat !== 'elapsedAndAbsolute';
  const resetsKey = timeFormat === 'absolute' ? "format.resets" : "format.resetsIn";

  const resetSuffix = reset
    ? showResetLabel && showResetWording
      ? `(${t(resetsKey)} ${reset})`
      : `(${reset})`
    : "";

  if (usageBarEnabled) {
    const body = resetSuffix
      ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} ${resetSuffix}`
      : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
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
