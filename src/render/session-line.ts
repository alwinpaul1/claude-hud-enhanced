import type { RenderContext, ModelQuota } from '../types.js';
import { isLimitReached, getMostRestrictiveQuota } from '../types.js';
import { getContextPercent, getModelName, getUsedTokens } from '../stdin.js';
import { coloredBar, cyan, dim, magenta, red, yellow, getContextColor, RESET, accent } from './colors.js';

const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';

// ANSI color codes for enhanced display
const ORANGE = '\x1b[38;5;208m';  // For warnings
const BLUE = '\x1b[38;5;39m';     // For info

/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for default and separators layouts.
 */
export function renderSessionLine(ctx: RenderContext): string {
  const model = getModelName(ctx.stdin);

  const percent = getContextPercent(ctx.stdin);

  const parts: string[] = [];
  const display = ctx.config?.display;

  // Model and context bar (FIRST)
  // Plan name only shows if showUsage is enabled (respects hybrid toggle)
  const showPlanName = display?.showUsage !== false && ctx.usageData?.planName;

  // Calculate used tokens and total tokens for display with colored progress bar
  // Use getUsedTokens which matches /context command calculation
  const totalTokens = getUsedTokens(ctx.stdin);
  const contextSize = ctx.stdin.context_window?.context_window_size ?? 0;
  const bar = coloredBar(percent);
  const tokenDisplay = `${getContextColor(percent)}${formatTokens(totalTokens)}/${formatTokens(contextSize)}${RESET}`;
  const percentDisplay = `${getContextColor(percent)}${percent}%${RESET}`;

  if (display?.showModel !== false) {
    const modelDisplay = showPlanName ? `${model} | ${ctx.usageData!.planName}` : model;
    parts.push(`${accent(`[${modelDisplay}]`)} ${bar} ${percentDisplay} ${tokenDisplay}`);
  } else {
    parts.push(`${bar} ${percentDisplay} ${tokenDisplay}`);
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

      gitPart = ` ${magenta('git:(')}${cyan(gitParts.join(''))}${magenta(')')}`;
    }

    parts.push(`${yellow(projectPath)}${gitPart}`);
  }

  // Config counts
  if (display?.showConfigCounts !== false) {
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

  // Usage limits display (shown when enabled in config)
  if (display?.showUsage !== false && ctx.usageData?.planName) {
    if (ctx.usageData.apiUnavailable) {
      parts.push(yellow(`usage: ⚠`));
    } else if (isLimitReached(ctx.usageData)) {
      // Show which limit is reached with both countdown AND reset time
      const fiveHourReached = ctx.usageData.fiveHour === 100;
      let fiveHourResetDisplay = '';
      if (fiveHourReached && ctx.usageData.fiveHourResetAt) {
        const countdown = ctx.usageData.fiveHourResetIn ?? formatResetTime(ctx.usageData.fiveHourResetAt);
        const resetTime = formatResetTimeOnly(ctx.usageData.fiveHourResetAt);
        fiveHourResetDisplay = countdown && resetTime 
          ? ` (${countdown}, Resets ${resetTime})`
          : countdown ? ` (${countdown})` : '';
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
      // Build usage display with time-to-reset countdown
      const fiveHourDisplay = formatUsagePercent(ctx.usageData.fiveHour);
      const fiveHourReset = ctx.usageData.fiveHourResetIn ?? formatResetTime(ctx.usageData.fiveHourResetAt);
      const fiveHourPart = fiveHourReset
        ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
        : `5h: ${fiveHourDisplay}`;

      // Always show 7-day usage if available with reset date/time
      const sevenDay = ctx.usageData.sevenDay;
      if (sevenDay !== null) {
        const sevenDayDisplay = formatUsagePercent(sevenDay);
        const sevenDayReset = formatResetDateTime(ctx.usageData.sevenDayResetAt);
        const sevenDayPart = sevenDayReset
          ? `7d: ${sevenDayDisplay} (${sevenDayReset})`
          : `7d: ${sevenDayDisplay}`;
        parts.push(`${fiveHourPart} | ${sevenDayPart}`);
      } else {
        parts.push(fiveHourPart);
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

  // Session duration
  if (display?.showDuration !== false && ctx.sessionDuration) {
    parts.push(dim(`⏱️  ${ctx.sessionDuration}`));
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

function formatUsagePercent(percent: number | null): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getContextColor(percent);
  return `${color}${percent}%${RESET}`;
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
