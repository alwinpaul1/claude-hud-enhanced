import type { RenderContext } from "../../types.js";
import { isLimitReached } from "../../types.js";
import { getProviderLabel } from "../../stdin.js";
import { critical, label, getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData) {
    return null;
  }

  if (getProviderLabel(ctx.stdin)) {
    return null;
  }

  const usageLabel = label(t("label.usage"), colors);

  if (isLimitReached(ctx.usageData)) {
    const resetTime =
      ctx.usageData.fiveHour === 100
        ? formatResetTime(ctx.usageData.fiveHourResetAt)
        : formatResetTime(ctx.usageData.sevenDayResetAt);
    return `${usageLabel} ${critical(`⚠ ${t("status.limitReached")}${resetTime ? ` (${t("format.resets")} ${resetTime})` : ""}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;

  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
  const barWidth = getAdaptiveBarWidth();

  if (fiveHour === null && sevenDay !== null) {
    const weeklyOnlyPart = formatUsageWindowPart({
      label: t("label.weekly"),
      percent: sevenDay,
      resetAt: ctx.usageData.sevenDayResetAt,
      colors,
      usageBarEnabled,
      barWidth,
      forceLabel: true,
      resetStyle: "datetime",
    });
    return `${usageLabel} ${weeklyOnlyPart}`;
  }

  const fiveHourPart = formatUsageWindowPart({
    label: "5h",
    percent: fiveHour,
    resetAt: ctx.usageData.fiveHourResetAt,
    colors,
    usageBarEnabled,
    barWidth,
    resetStyle: "time",
  });

  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayPart = formatUsageWindowPart({
      label: t("label.weekly"),
      percent: sevenDay,
      resetAt: ctx.usageData.sevenDayResetAt,
      colors,
      usageBarEnabled,
      barWidth,
      forceLabel: true,
      resetStyle: "datetime",
    });
    return `${usageLabel} ${fiveHourPart} | ${sevenDayPart}`;
  }

  return `${usageLabel} ${fiveHourPart}`;
}

function formatUsagePercent(
  percent: number | null,
  colors?: RenderContext["config"]["colors"],
): string {
  if (percent === null) {
    return label("--", colors);
  }
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}

function formatUsageWindowPart({
  label: windowLabel,
  percent,
  resetAt,
  colors,
  usageBarEnabled,
  barWidth,
  forceLabel = false,
  resetStyle = "countdown",
}: {
  label: string;
  percent: number | null;
  resetAt: Date | null;
  colors?: RenderContext["config"]["colors"];
  usageBarEnabled: boolean;
  barWidth: number;
  forceLabel?: boolean;
  resetStyle?: "countdown" | "datetime" | "time";
}): string {
  const usageDisplay = formatUsagePercent(percent, colors);
  const reset = resetStyle === "datetime"
    ? formatResetDateTime(resetAt)
    : resetStyle === "time"
      ? formatResetTimeOfDay(resetAt)
      : formatResetTime(resetAt);
  const resetPrefix = resetStyle === "datetime" || resetStyle === "time"
    ? t("format.resets")
    : t("format.resetsIn");
  const styledLabel = label(windowLabel, colors);

  if (usageBarEnabled) {
    const body = reset
      ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} (${resetPrefix} ${reset})`
      : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
    return forceLabel ? `${styledLabel} ${body}` : body;
  }

  return reset
    ? `${styledLabel} ${usageDisplay} (${resetPrefix} ${reset})`
    : `${styledLabel} ${usageDisplay}`;
}

function formatResetDateTime(resetAt: Date | null): string {
  if (!resetAt) return "";
  const now = new Date();
  if (resetAt.getTime() <= now.getTime()) return "";
  const weekday = resetAt.toLocaleDateString("en-US", { weekday: "short" });
  const time = resetAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${weekday} ${time}`;
}

function formatResetTimeOfDay(resetAt: Date | null): string {
  if (!resetAt) return "";
  const now = new Date();
  if (resetAt.getTime() <= now.getTime()) return "";
  return resetAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return "";
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return "";

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) return `${days}d ${remHours}h`;
    return `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
