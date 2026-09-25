import type { RenderContext, ScopedUsageWindow } from '../types.js';
import { isLimitReached } from '../types.js';
import { getContextPercent, getBufferedPercent, getModelName, formatModelName, resolveModelName, shouldHideUsage } from '../stdin.js';
import { getOutputSpeed } from '../speed-tracker.js';
import { coloredBar, critical, git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, getContextColor, getQuotaColor, quotaBar, custom as customColor, RESET } from './colors.js';
import { getAdaptiveBarWidth } from '../utils/terminal.js';
import { renderCostEstimate } from './lines/cost.js';
import { renderPromptCacheLine } from './lines/prompt-cache.js';
import { renderSessionTimeLine } from './lines/session-time.js';
import { formatStaleUsageMarker } from './lines/usage.js';
import { renderAdvisorLine } from './lines/advisor.js';
import { t } from '../i18n/index.js';
import type { TimeFormatMode, UsageValueMode } from '../config.js';
import { formatResetTime, sameResetMinute, SHARED_RESET_JOINER, type WallClockOptions } from './format-reset-time.js';
import { formatTokens, formatContextValue } from '../utils/format.js';
import { formatAuthSegment } from '../auth.js';
import { createDebug } from '../debug.js';
import { formatModelDisplay } from './model-display.js';
import { formatSessionTokenSummary } from './lines/session-tokens.js';
import { formatProjectPath } from './project-path.js';
import { DEFAULT_PROJECT_LINE_ORDER } from '../config.js';
import type { FirstLineSegment } from '../config.js';
import { orderFirstLineParts } from './first-line-order.js';
import type { FirstLinePart } from './first-line-order.js';
import { getVcsDisplayState } from './vcs-status.js';

const debug = createDebug('session-line');

/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode.
 */
export interface SessionLineOptions {
  /**
   * True when a row fits the terminal. When given, the usage row narrows itself
   * (see fitUsageRow) instead of overflowing and losing its last segments.
   */
  fitsRow?: (row: string) => boolean;
}

export function renderSessionLine(ctx: RenderContext, options: SessionLineOptions = {}): string {
  const model = formatModelName(resolveModelName(ctx.stdin, ctx.transcript, ctx.config?.display?.modelSource), ctx.config?.display?.modelFormat, ctx.config?.display?.modelOverride);

  const autoCompactWindow = ctx.config?.display?.autoCompactWindow ?? null;
  const rawPercent = getContextPercent(ctx.stdin, autoCompactWindow);
  const bufferedPercent = getBufferedPercent(ctx.stdin, autoCompactWindow);
  const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
  const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;

  if (autocompactMode === 'disabled') {
    debug(`autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
  }

  const colors = ctx.config?.colors;
  const display = ctx.config?.display;
  const contextThresholds = {
    warning: display?.contextWarningThreshold,
    critical: display?.contextCriticalThreshold,
  };
  const barWidth = getAdaptiveBarWidth();
  const bar = coloredBar(percent, barWidth, colors, contextThresholds);

  const parts: FirstLinePart[] = [];
  const push = (text: string, key: FirstLineSegment | null = null) => parts.push({ key, text });
  const timeFormat: TimeFormatMode = display?.timeFormat ?? 'relative';
  const wallClockOpts: WallClockOptions = {
    hourCycle: display?.hourCycle ?? 'auto',
    showSeconds: display?.showClockSeconds ?? false,
  };
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
  const contextValueMode = display?.contextValue ?? 'percent';
  const contextValue = formatContextValue(ctx, percent, contextValueMode);
  const contextValueDisplay = `${getContextColor(percent, colors, contextThresholds)}${contextValue}${RESET}`;

  const customLine = display?.customLine;
  const customLinePosition = display?.customLinePosition ?? 'last';
  if (customLine && customLinePosition === 'first') {
    push(customColor(customLine, colors));
  }

  // Model and context bar
  const modelDisplay = formatModelDisplay(model, ctx);

  // The compact layout keeps the context bar attached to the model badge, so
  // the whole cluster reorders as the coarse 'model' segment.
  if (display?.showModel !== false && display?.showContextBar !== false) {
    push(`${modelColor(`[${modelDisplay}]`, colors)} ${bar} ${contextValueDisplay}`, 'model');
  } else if (display?.showModel !== false) {
    push(`${modelColor(`[${modelDisplay}]`, colors)} ${contextValueDisplay}`, 'model');
  } else if (display?.showContextBar !== false) {
    push(`${bar} ${contextValueDisplay}`, 'model');
  } else {
    push(contextValueDisplay, 'model');
  }

  // Project path + git status
  let projectPart: string | null = null;
  if (display?.showProject !== false && ctx.stdin.cwd) {
    const pathLevels = ctx.config?.pathLevels ?? 1;
    const projectPath = formatProjectPath(ctx.stdin.cwd, pathLevels);
    projectPart = projectColor(projectPath, colors);
  }

  let gitPart = '';
  const vcs = getVcsDisplayState(ctx.gitStatus, ctx.config);
  const branchOverflow = vcs?.branchOverflow ?? ctx.config.gitStatus?.branchOverflow ?? 'truncate';

  if (vcs) {
    const gitParts: string[] = [vcs.branch];

    // Show dirty indicator
    if (vcs.dirty) {
      gitParts.push('*');
    }

    // Show ahead/behind (with space separator for readability)
    if (vcs.ahead > 0) {
      gitParts.push(` ↑${vcs.ahead}`);
    }
    if (vcs.behind > 0) {
      gitParts.push(` ↓${vcs.behind}`);
    }

    // Show file stats in Starship-compatible format (!modified +added ✘deleted ?untracked)
    if (vcs.fileStats) {
      const { modified, added, deleted, untracked } = vcs.fileStats;
      const statParts: string[] = [];
      if (modified > 0) statParts.push(`!${modified}`);
      if (added > 0) statParts.push(`+${added}`);
      if (deleted > 0) statParts.push(`✘${deleted}`);
      if (untracked > 0) statParts.push(`?${untracked}`);
      if (statParts.length > 0) {
        gitParts.push(` ${statParts.join(' ')}`);
      }
    }

    const conflictPart = vcs.conflict ? ` ${critical('!conflict', colors)}` : '';
    gitPart = `${gitColor(`${vcs.kind}:(`, colors)}${gitBranchColor(gitParts.join(''), colors)}${conflictPart}${gitColor(')', colors)}`;
  }

  if (projectPart && gitPart) {
    if (branchOverflow === 'wrap') {
      push(projectPart, 'project');
      push(gitPart, 'project');
    } else {
      push(`${projectPart} ${gitPart}`, 'project');
    }
  } else if (projectPart) {
    push(projectPart, 'project');
  } else if (gitPart) {
    push(gitPart, 'project');
  }

  // Session name (custom title from /rename, or auto-generated slug)
  if (display?.showSessionName && ctx.transcript.sessionName) {
    push(label(ctx.transcript.sessionName, colors), 'sessionName');
  }

  if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
    push(label(`CC v${ctx.claudeCodeVersion}`, colors), 'version');
  }

  // Config counts (respects environmentThreshold)
  if (display?.showConfigCounts === true) {
    const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
    const envThreshold = display?.environmentThreshold ?? 0;

    if (totalCounts > 0 && totalCounts >= envThreshold) {
      if (ctx.claudeMdCount > 0) {
        push(label(`${ctx.claudeMdCount} CLAUDE.md`, colors));
      }

      if (ctx.rulesCount > 0) {
        push(label(`${ctx.rulesCount} ${t('label.rules')}`, colors));
      }

      if (ctx.mcpCount > 0) {
        push(label(`${ctx.mcpCount} MCPs`, colors));
      }

      if (ctx.hooksCount > 0) {
        push(label(`${ctx.hooksCount} ${t('label.hooks')}`, colors));
      }
    }
  }

  // Usage limits display (shown when enabled in config, respects usageThreshold).
  // Snapshot where usage parts begin so `usageOnNewLine` can peel them onto row 2.
  const usageStartIndex = parts.length;
  const usageStyle: UsageRowStyle = {
    bars: display?.usageBarEnabled ?? true,
    resetLabel: display?.showResetLabel ?? true,
    compact: display?.usageCompact ?? false,
    resetTimes: true,
  };
  const usageTexts = renderUsageParts(ctx, usageStyle, barWidth);
  usageTexts.forEach((text) => push(text));

  // Session token usage (cumulative)
  if (display?.showSessionTokens && ctx.transcript.sessionTokens) {
    const summary = formatSessionTokenSummary(ctx.transcript.sessionTokens, `${t('format.tok')}:`);
    if (summary) {
      push(label(summary, colors));
    }
  }

  // Compaction count from transcript compact_boundary entries (opt-in,
  // hidden until the first compaction)
  if (display?.showCompactions) {
    const compactions = ctx.transcript.compactionCount ?? 0;
    if (compactions > 0) {
      push(label(`${t('label.compactions')}: ${compactions}`, colors));
    }
  }

  // Compact layout: when usageOnNewLine is set, peel the usage/weekly parts off
  // row 1 so they render as a deterministic second row (row 1 keeps
  // identity/project/counts/duration; row 2 starts with the usage windows).
  const usageParts = display?.usageOnNewLine
    ? fitUsageRow(
        ctx,
        parts.splice(usageStartIndex).map((part) => part.text),
        usageTexts.length,
        usageStyle,
        barWidth,
        options.fitsRow,
      )
    : [];

  // Advisor model (when `/advisor` is configured for the session)
  if (display?.showAdvisor) {
    const advisorLine = renderAdvisorLine(ctx);
    if (advisorLine) {
      push(advisorLine, 'advisor');
    }
  }

  if (display?.showDuration === true && ctx.sessionDuration) {
    push(label(`⏱️  ${ctx.sessionDuration}`, colors), 'duration');
  }

  const sessionTimeLine = renderSessionTimeLine(ctx);
  if (sessionTimeLine) {
    push(sessionTimeLine);
  }

  const promptCacheLine = renderPromptCacheLine(ctx);
  if (promptCacheLine) {
    push(promptCacheLine);
  }

  const costEstimate = renderCostEstimate(ctx);
  if (costEstimate) {
    push(costEstimate, 'cost');
  }

  if (display?.showSpeed) {
    const speed = getOutputSpeed(ctx.stdin);
    if (speed !== null) {
      push(label(`${t('format.out')}: ${speed.toFixed(1)} ${t('format.tokPerSec')}`, colors), 'speed');
    }
  }

  if (ctx.extraLabel) {
    push(label(ctx.extraLabel, colors), 'extra');
  }

  const authSegment = formatAuthSegment(ctx.authInfo, display);
  if (authSegment && !display?.showAuthInModel) {
    push(label(authSegment, colors), 'auth');
  }

  if (customLine && customLinePosition === 'last') {
    push(customColor(customLine, colors));
  }

  const order = ctx.config?.projectLineOrder ?? DEFAULT_PROJECT_LINE_ORDER;
  let line = orderFirstLineParts(parts, order).join(' | ');

  // Token breakdown at high context
  if (display?.showTokenBreakdown !== false && percent >= (display?.contextCriticalThreshold ?? 85)) {
    const usage = ctx.stdin.context_window?.current_usage;
    if (usage) {
      const input = formatTokens(usage.input_tokens ?? 0);
      const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
      line += label(` (${t('format.in')}: ${input}, ${t('format.cache')}: ${cache})`, colors);
    }
  }

  if (usageParts.length > 0) {
    const usageLine = usageParts.join(' | ');
    line = line.length > 0 ? `${line}\n${usageLine}` : usageLine;
  }

  return line;
}

/** How much of the usage row to draw; narrowed step by step when the row does not fit. */
interface UsageRowStyle {
  bars: boolean;
  resetLabel: boolean;
  compact: boolean;
  /** False only on the last step: reset times go so every window still fits. */
  resetTimes: boolean;
}

/**
 * The usage/weekly parts of the session line, in order. Writes no caches, so the
 * caller can rebuild it in a narrower style when the row does not fit.
 */
function renderUsageParts(ctx: RenderContext, style: UsageRowStyle, barWidth: number): string[] {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;
  if (display?.showUsage === false || !ctx.usageData || shouldHideUsage(ctx.stdin)) {
    return [];
  }

  const parts: string[] = [];
  const push = (text: string) => parts.push(text);
  const timeFormat: TimeFormatMode = display?.timeFormat ?? 'relative';
  const wallClockOpts: WallClockOptions = {
    hourCycle: display?.hourCycle ?? 'auto',
    showSeconds: display?.showClockSeconds ?? false,
  };
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
  const usageCompact = style.compact;
  const showResetLabel = style.resetLabel;
  const resetAtOf = (resetAt: Date | null): Date | null => (style.resetTimes ? resetAt : null);
  const usageValueMode = display?.usageValue ?? 'percent';
  const scopedWindows = ctx.usageData.scopedWindows ?? [];
  const hasGenericWindowData = ctx.usageData.fiveHour !== null || ctx.usageData.sevenDay !== null;
  const hasWindowData = hasGenericWindowData || scopedWindows.length > 0;
  const scopedPart = (window: ScopedUsageWindow, withReset = true): string =>
    usageCompact
      ? formatCompactWindowPart(
          window.label,
          window.percent,
          withReset ? resetAtOf(window.resetAt) : null,
          timeFormat,
          colors,
          usageValueMode,
          wallClockOpts,
        )
      : formatUsageWindowPart({
          label: window.label,
          percent: window.percent,
          resetAt: withReset ? window.resetAt : null,
          colors,
          usageBarEnabled: style.bars,
          barWidth,
          timeFormat,
          showResetLabel,
          forceLabel: true,
          usageValueMode,
          windowDurationLabel: '7d',
          wallClockOpts,
        });
  const scopedParts = scopedWindows.map((window) => scopedPart(window));

  // The weekly window followed by the scoped windows. Those that reset in the
  // same minute as the weekly one (Fable does) join it as one " · " group that
  // prints the shared reset once, at the end; the rest keep their own.
  const weeklyGroup = (renderWeekly: (withReset: boolean) => string): string[] => {
    const weeklyResetAt = ctx.usageData?.sevenDayResetAt ?? null;
    const shared = scopedWindows.filter((window) => sameResetMinute(window.resetAt, weeklyResetAt));
    const separate = scopedWindows.filter((window) => !shared.includes(window));
    if (shared.length === 0) {
      return [renderWeekly(true), ...scopedParts];
    }
    const group = [
      renderWeekly(false),
      ...shared.map((window, index) => scopedPart(window, index === shared.length - 1)),
    ].join(SHARED_RESET_JOINER);
    return [group, ...separate.map((window) => scopedPart(window))];
  };

  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100
      ? formatResetTime(resetAtOf(ctx.usageData.fiveHourResetAt), timeFormat, 'short', wallClockOpts)
      : formatResetTime(resetAtOf(ctx.usageData.sevenDayResetAt), timeFormat, 'long', wallClockOpts);
    if (usageCompact) {
      push(critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ''}`, colors));
    } else {
      const resetSuffix = resetTime
        ? showResetLabel
          ? ` (${t(resetsKey)} ${resetTime})`
          : ` (${resetTime})`
        : '';
      push(critical(`⚠ ${t('status.limitReached')}${resetSuffix}`, colors));
    }
    scopedParts.forEach((part) => push(part));
  } else {
    const usageThreshold = display?.usageThreshold ?? 0;
    const fiveHour = ctx.usageData.fiveHour;
    const sevenDay = ctx.usageData.sevenDay;
    const effectiveUsage = Math.max(
      fiveHour ?? 0,
      sevenDay ?? 0,
      ...scopedWindows.map((window) => window.percent ?? 0),
    );

    if ((hasWindowData || !ctx.usageData.balanceLabel) && effectiveUsage >= usageThreshold) {
      const usageBarEnabled = style.bars;
      if (usageCompact) {
        const fiveHourPart = fiveHour !== null
          ? formatCompactWindowPart('5h', fiveHour, resetAtOf(ctx.usageData.fiveHourResetAt), timeFormat, colors, usageValueMode, wallClockOpts)
          : null;
        const sevenDayThreshold = display?.sevenDayThreshold ?? 0;
        const showSevenDay = sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold);
        const sevenDayResetAt = ctx.usageData.sevenDayResetAt;
        const sevenDayPart = (withReset: boolean) =>
          formatCompactWindowPart('7d', sevenDay, withReset ? resetAtOf(sevenDayResetAt) : null, timeFormat, colors, usageValueMode, wallClockOpts);

        if (fiveHourPart) {
          push(fiveHourPart);
        }
        (showSevenDay ? weeklyGroup(sevenDayPart) : scopedParts).forEach((part) => push(part));
      } else if (fiveHour === null && sevenDay !== null) {
        const sevenDayResetAt = ctx.usageData.sevenDayResetAt;
        const weeklyOnlyPart = (withReset: boolean) => formatUsageWindowPart({
          label: t('label.weekly'),
          percent: sevenDay,
          resetAt: withReset ? sevenDayResetAt : null,
          colors,
          usageBarEnabled,
          barWidth,
          timeFormat,
          showResetLabel,
          forceLabel: true,
          usageValueMode,
          wallClockOpts,
        });
        weeklyGroup(weeklyOnlyPart).forEach((part) => push(part));
      } else if (hasGenericWindowData || !hasWindowData) {
        const fiveHourPart = formatUsageWindowPart({
          label: '5h',
          percent: fiveHour,
          resetAt: ctx.usageData.fiveHourResetAt,
          colors,
          usageBarEnabled,
          barWidth,
          timeFormat,
          showResetLabel,
          usageValueMode,
          wallClockOpts,
        });

        const sevenDayThreshold = display?.sevenDayThreshold ?? 0;
        if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
          const sevenDayResetAt = ctx.usageData.sevenDayResetAt;
          const sevenDayPart = (withReset: boolean) => formatUsageWindowPart({
            label: t('label.weekly'),
            percent: sevenDay,
            resetAt: withReset ? sevenDayResetAt : null,
            colors,
            usageBarEnabled,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: true,
            usageValueMode,
            wallClockOpts,
          });
          push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
          weeklyGroup(sevenDayPart).forEach((part) => push(part));
        } else {
          push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
          scopedParts.forEach((part) => push(part));
        }
      } else if (scopedParts.length > 0) {
        const [firstScopedPart, ...remainingScopedParts] = scopedParts;
        push(`${label(t('label.usage'), colors)} ${firstScopedPart}`);
        remainingScopedParts.forEach((part) => push(part));
      }
    }
  }

  if (ctx.usageData.balanceLabel) {
    if (!hasWindowData) {
      push(`${label(t('label.usage'), colors)} ${ctx.usageData.balanceLabel}`);
    } else {
      push(ctx.usageData.balanceLabel);
    }
  }

  if (ctx.usageData.staleSince && parts.length > 0) {
    push(formatStaleUsageMarker(ctx.usageData.staleSince, colors));
  }

  return parts;
}

/**
 * Narrower usage styles, tried in order when the usage row is wider than the
 * terminal: drop the bars, then the "resets" wording, then fall back to the
 * compact "5h:/7d:" form, and last drop the reset times so a third window
 * (e.g. Fable) still fits. Without this, compactSingleRow cut the row at a
 * segment boundary, and the segment it cut was the weekly window.
 */
function fitUsageRow(
  ctx: RenderContext,
  row: string[],
  usageCount: number,
  style: UsageRowStyle,
  barWidth: number,
  fitsRow?: (row: string) => boolean,
): string[] {
  if (!fitsRow || usageCount === 0 || fitsRow(row.join(' | '))) {
    return row;
  }

  const extras = row.slice(usageCount);
  const steps: UsageRowStyle[] = [
    { ...style, bars: false },
    { ...style, bars: false, resetLabel: false },
    { bars: false, resetLabel: false, compact: true, resetTimes: true },
    { bars: false, resetLabel: false, compact: true, resetTimes: false },
  ];
  let fitted = row;
  for (const step of steps) {
    fitted = [...renderUsageParts(ctx, step, barWidth), ...extras];
    if (fitsRow(fitted.join(' | '))) {
      break;
    }
  }
  return fitted;
}

function formatCompactWindowPart(
  windowLabel: string,
  percent: number | null,
  resetAt: Date | null,
  timeFormat: TimeFormatMode,
  colors?: RenderContext['config']['colors'],
  usageValueMode: UsageValueMode = 'percent',
  wallClockOpts?: WallClockOptions,
): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatResetTime(resetAt, timeFormat, windowLabel === '5h' ? 'short' : 'long', wallClockOpts);
  const styledLabel = label(`${windowLabel}:`, colors);
  return reset
    ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
    : `${styledLabel} ${usageDisplay}`;
}

function formatUsagePercent(
  percent: number | null,
  colors?: RenderContext['config']['colors'],
  mode: UsageValueMode = 'percent',
): string {
  if (percent === null) {
    return label('--', colors);
  }
  const color = getQuotaColor(percent, colors);
  const displayPercent = mode === 'remaining' ? Math.max(0, 100 - percent) : percent;
  return `${color}${displayPercent}%${RESET}`;
}

function formatUsageWindowPart({
  label: windowLabel,
  percent,
  resetAt,
  colors,
  usageBarEnabled,
  barWidth,
  timeFormat = 'relative',
  showResetLabel,
  forceLabel = false,
  usageValueMode = 'percent',
  windowDurationLabel,
  wallClockOpts,
}: {
  label: string;
  percent: number | null;
  resetAt: Date | null;
  colors?: RenderContext['config']['colors'];
  usageBarEnabled: boolean;
  barWidth: number;
  timeFormat?: TimeFormatMode;
  showResetLabel: boolean;
  forceLabel?: boolean;
  usageValueMode?: UsageValueMode;
  windowDurationLabel?: string;
  wallClockOpts?: WallClockOptions;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors, usageValueMode);
  const reset = formatResetTime(resetAt, timeFormat, windowLabel === '5h' ? 'short' : 'long', wallClockOpts);
  const styledLabel = label(windowLabel, colors);
  // "resets in X" for relative/both; "resets X" for absolute (avoids "resets in at 14:30")
  const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';

  if (usageBarEnabled) {
    // Relative mode keeps the upstream "(duration / windowLabel)" pattern (e.g. "2h 30m / 5h").
    // Absolute/both modes use the preposition form instead — "(at 14:30 / 5h)" is incoherent.
    const barReset = timeFormat === 'relative'
      ? (reset ? `${reset} / ${windowDurationLabel ?? windowLabel}` : null)
      : (reset ? (showResetLabel ? `${t(resetsKey)} ${reset}` : reset) : null);
    const body = barReset
      ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} (${barReset})`
      : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
    return forceLabel ? `${styledLabel} ${body}` : body;
  }

  const resetSuffix = reset
    ? showResetLabel
      ? `(${t(resetsKey)} ${reset})`
      : `(${reset})`
    : '';

  return resetSuffix
    ? `${styledLabel} ${usageDisplay} ${resetSuffix}`
    : `${styledLabel} ${usageDisplay}`;
}
