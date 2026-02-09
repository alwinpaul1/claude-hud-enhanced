import type { RenderContext, ModelQuota } from '../types.js';
import { isLimitReached, getMostRestrictiveQuota } from '../types.js';
import { getContextPercent, getBufferedPercent, getModelName, getProviderLabel, getTotalTokens } from '../stdin.js';
import { getOutputSpeed } from '../speed-tracker.js';
import { coloredBar, cyan, dim, magenta, red, yellow, getContextColor, quotaBar, RESET } from './colors.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

const BLUE = '\x1b[94m';

/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode.
 */
export function renderSessionLine(ctx: RenderContext): string {
  const model = getModelName(ctx.stdin);

  const rawPercent = getContextPercent(ctx.stdin);
  const bufferedPercent = getBufferedPercent(ctx.stdin);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;

  if (DEBUG && autocompactMode === 'disabled') {
    console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
  }

  const bar = coloredBar(percent);

  const parts: string[] = [];
  const display = ctx.config?.display;
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);
  const contextValueDisplay = `${getContextColor(percent)}${contextValue}${RESET}`;

  // Model and context bar (FIRST)
  // Plan name only shows if showUsage is enabled (respects hybrid toggle)
  const providerLabel = getProviderLabel(ctx.stdin);
  const planName = display?.showUsage !== false ? ctx.usageData?.planName : undefined;
  const planDisplay = providerLabel ?? planName;
  const modelDisplay = planDisplay ? `${model} | ${planDisplay}` : model;

  if (display?.showModel !== false && display?.showContextBar !== false) {
    parts.push(`${cyan(`[${modelDisplay}]`)} ${bar} ${contextValueDisplay}`);
  } else if (display?.showModel !== false) {
    parts.push(`${cyan(`[${modelDisplay}]`)} ${contextValueDisplay}`);
  } else if (display?.showContextBar !== false) {
    parts.push(`${bar} ${contextValueDisplay}`);
  } else {
    parts.push(contextValueDisplay);
  }

  // Project path (SECOND)
  if (ctx.stdin.cwd) {
    // Split by both Unix (/) and Windows (\) separators for cross-platform support
    const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
    const pathLevels = ctx.config?.pathLevels ?? 1;
    // Always join with forward slash for consistent display
    // Handle root path (/) which results in empty segments
    const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';

    // Build git status string
    let gitPart = '';
    const gitConfig = ctx.config?.gitStatus;
    const showGit = gitConfig?.enabled ?? true;

    if (showGit && ctx.gitStatus) {
      const gitParts: string[] = [ctx.gitStatus.branch];

      // Show dirty indicator
      if ((gitConfig?.showDirty ?? true) && ctx.gitStatus.isDirty) {
        gitParts.push('*');
      }

      // Show ahead/behind (with space separator for readability)
      if (gitConfig?.showAheadBehind) {
        if (ctx.gitStatus.ahead > 0) {
          gitParts.push(` ↑${ctx.gitStatus.ahead}`);
        }
        if (ctx.gitStatus.behind > 0) {
          gitParts.push(` ↓${ctx.gitStatus.behind}`);
        }
      }

      // Show file stats in Starship-compatible format (!modified +added ✘deleted ?untracked)
      if (gitConfig?.showFileStats && ctx.gitStatus.fileStats) {
        const { modified, added, deleted, untracked } = ctx.gitStatus.fileStats;
        const statParts: string[] = [];
        if (modified > 0) statParts.push(`!${modified}`);
        if (added > 0) statParts.push(`+${added}`);
        if (deleted > 0) statParts.push(`✘${deleted}`);
        if (untracked > 0) statParts.push(`?${untracked}`);
        if (statParts.length > 0) {
          gitParts.push(` ${statParts.join(' ')}`);
        }
      }

      gitPart = ` ${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
    }

    parts.push(`${yellow(projectPath)}${gitPart}`);
  }

  // Config counts (respects environmentThreshold)
  if (display?.showConfigCounts !== false) {
    const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const envThreshold = display?.environmentThreshold ?? 0;

    if (totalCounts > 0 && totalCounts >= envThreshold) {
      if (ctx.claudeMdCount > 0) {
        parts.push(dim(`${ctx.claudeMdCount} CLAUDE.md`));
      }

      if (ctx.rulesCount > 0) {
        parts.push(dim(`${ctx.rulesCount} rules`));
      }

      if (ctx.mcpCount > 0) {
        parts.push(dim(`${ctx.mcpCount} MCPs`));
      }

      if (ctx.hooksCount > 0) {
        parts.push(dim(`${ctx.hooksCount} hooks`));
      }
    }
  }

  // Usage limits display (shown when enabled in config, respects usageThreshold)
  if (display?.showUsage !== false && ctx.usageData?.planName && !providerLabel) {
    if (ctx.usageData.apiUnavailable) {
      const errorHint = formatUsageError(ctx.usageData.apiError);
      parts.push(yellow(`usage: ⚠${errorHint}`));
    } else if (isLimitReached(ctx.usageData)) {
      // Show which limit is reached with readable reset time
      const fiveHourReached = ctx.usageData.fiveHour === 100;
      let fiveHourResetDisplay = '';
      if (fiveHourReached && ctx.usageData.fiveHourResetAt) {
        const resetTime = formatResetTimeOnly(ctx.usageData.fiveHourResetAt);
        fiveHourResetDisplay = resetTime ? ` Resets ${resetTime}` : '';
      }

      // Always show 7-day usage with reset date/time alongside the limit reached warning
      let sevenDayDisplay = '';
      if (ctx.usageData.sevenDay !== null) {
        const sevenDayReset = formatResetDateTime(ctx.usageData.sevenDayResetAt);
        sevenDayDisplay = sevenDayReset
          ? ` | 7d: ${formatUsagePercent(ctx.usageData.sevenDay)} (${sevenDayReset})`
          : ` | 7d: ${formatUsagePercent(ctx.usageData.sevenDay)}`;
      }

      parts.push(red(`⚠ 5h limit${fiveHourResetDisplay}`) + sevenDayDisplay);
    } else {
      const usageThreshold = display?.usageThreshold ?? 0;
      const fiveHour = ctx.usageData.fiveHour;
      const sevenDay = ctx.usageData.sevenDay;
      const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);

      if (effectiveUsage >= usageThreshold) {
        // Build usage display with countdown and readable reset times
        const fiveHourDisplay = formatUsagePercent(fiveHour);
        const fiveHourReset = ctx.usageData.fiveHourResetIn ?? formatResetTime(ctx.usageData.fiveHourResetAt);

        const usageBarEnabled = display?.usageBarEnabled ?? true;
        const fiveHourPart = usageBarEnabled
          ? (fiveHourReset
            ? `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay} (${fiveHourReset})`
            : `${quotaBar(fiveHour ?? 0)} ${fiveHourDisplay}`)
          : (fiveHourReset
            ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
            : `5h: ${fiveHourDisplay}`);

        // Always show 7-day usage if available with readable reset date/time
        const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
        if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
          const sevenDayDisplay = formatUsagePercent(sevenDay);
          const sevenDayReset = formatResetDateTime(ctx.usageData.sevenDayResetAt);
          const sevenDayPart = usageBarEnabled
            ? (sevenDayReset
              ? `${quotaBar(sevenDay)} ${sevenDayDisplay} (${sevenDayReset})`
              : `${quotaBar(sevenDay)} ${sevenDayDisplay}`)
            : (sevenDayReset
              ? `7d: ${sevenDayDisplay} (${sevenDayReset})`
              : `7d: ${sevenDayDisplay}`);
          parts.push(`${fiveHourPart} | ${sevenDayPart}`);
        } else {
          parts.push(fiveHourPart);
        }
      }
    }

    // Show Max plan tier if available (Max5 = 88k, Max20 = 220k tokens/window)
    if (ctx.usageData.maxPlanInfo?.tier) {
      const tierInfo = ctx.usageData.maxPlanInfo;
      const tokens = tierInfo.tokensPerWindow ? formatTokens(tierInfo.tokensPerWindow) : '';
      parts.push(dim(`${BLUE}${tierInfo.tier}${RESET}${tokens ? dim(` ${tokens}/win`) : ''}`));
    }

    // Show model-specific quotas if any are > 50% utilized
    const modelQuota = getMostRestrictiveQuota(ctx.usageData);
    if (modelQuota && modelQuota.utilization !== null && modelQuota.utilization >= 50) {
      const quotaDisplay = formatModelQuota(modelQuota);
      parts.push(quotaDisplay);
    }

    // Show compaction buffer threshold if different from default
    if (ctx.usageData.compactionInfo?.isEnabled && ctx.usageData.compactionInfo.bufferPercent !== 80) {
      parts.push(dim(`compact@${ctx.usageData.compactionInfo.bufferPercent}%`));
    }
  }

  // Output speed
  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      parts.push(dim(`out: ${speed.toFixed(1)} tok/s`));
    }
  }

  // Session duration
  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(dim(`⏱️  ${ctx.sessionDuration}`));
  }

  if (ctx.extraLabel) {
    parts.push(dim(ctx.extraLabel));
  }

  let line = parts.join(' | ');

  // Token breakdown at high context
  if (display?.showTokenBreakdown !== false && percent >= 85) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += dim(` (in: ${input}, cache: ${cache})`);
    }
  }

  return line;
}

function formatTokens(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}

function formatContextValue(ctx: RenderContext, percent: number, mode: 'percent' | 'tokens'): string {
  if (mode === 'tokens') {
    const totalTokens = getTotalTokens(ctx.stdin);
    const size = ctx.stdin.context_window?.context_window_size ?? 0;
    if (size > 0) {
      return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
    }
    return formatTokens(totalTokens);
  }

  return `${percent}%`;
}

function formatUsagePercent(percent: number | null): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getContextColor(percent);
  return `${color}${percent}%${RESET}`;
}

function formatUsageError(error?: string): string {
  if (!error) return '';
  if (error.startsWith('http-')) {
    return ` (${error.slice(5)})`;
  }
  return ` (${error})`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  // Handle days for longer durations (7-day reset)
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format reset time as readable date/time: "Resets Fri 12:29 PM"
 * Used for 7-day weekly reset display
 */
function formatResetDateTime(resetAt: Date | null): string {
  if (!resetAt) return '';

  const now = new Date();
  if (resetAt.getTime() <= now.getTime()) return '';

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayName = days[resetAt.getDay()];

  let hours = resetAt.getHours();
  const mins = resetAt.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';

  // Convert to 12-hour format
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12

  const minsStr = mins < 10 ? `0${mins}` : `${mins}`;

  return `Resets ${dayName} ${hours}:${minsStr} ${ampm}`;
}

/**
 * Format reset time as just time: "2:30 PM"
 * Used for 5-hour reset display (same day, so no need for day name)
 */
function formatResetTimeOnly(resetAt: Date | null): string {
  if (!resetAt) return '';

  const now = new Date();
  if (resetAt.getTime() <= now.getTime()) return '';

  let hours = resetAt.getHours();
  const mins = resetAt.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';

  // Convert to 12-hour format
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12

  const minsStr = mins < 10 ? `0${mins}` : `${mins}`;

  return `${hours}:${minsStr} ${ampm}`;
}

/**
 * Format model-specific quota display
 * Shows model name, utilization, and weekly hours if available
 */
function formatModelQuota(quota: ModelQuota): string {
  const util = quota.utilization ?? 0;
  const color = getContextColor(util);

  // Short name for display
  const shortName = quota.displayName
    .replace('Claude ', '')
    .replace(' ', '')
    .substring(0, 8);

  let display = `${color}${shortName}: ${util}%${RESET}`;

  // Add weekly hours if available (compute-intensive models like Opus 4.5)
  if (quota.weeklyHoursUsed !== null && quota.weeklyHoursLimit !== null) {
    display += dim(` (${quota.weeklyHoursUsed}/${quota.weeklyHoursLimit}h/wk)`);
  }

  return display;
}
