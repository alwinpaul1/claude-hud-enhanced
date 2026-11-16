import { isLimitReached } from '../types.js';
import { getContextPercent, getBufferedPercent, formatModelName, resolveModelName, shouldHideUsage } from '../stdin.js';
import { getOutputSpeed } from '../speed-tracker.js';
import { coloredBar, critical, git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, getContextColor, quotaBar, custom as customColor, RESET } from './colors.js';
import { getAdaptiveBarWidth } from '../utils/terminal.js';
import { renderCostEstimate } from './lines/cost.js';
import { renderPromptCacheLine } from './lines/prompt-cache.js';
import { renderSessionTimeLine } from './lines/session-time.js';
import { formatStaleUsageMarker } from './lines/usage.js';
import { renderAdvisorLine } from './lines/advisor.js';
import { t } from '../i18n/index.js';
import { formatResetTime, sameResetMinute } from './format-reset-time.js';
import { hasFigure } from '../usage-available.js';
import { formatTokens, formatContextValue } from '../utils/format.js';
import { formatAuthSegment } from '../auth.js';
import { createDebug } from '../debug.js';
import { formatModelDisplay } from './model-display.js';
import { formatSessionTokenSummary } from './lines/session-tokens.js';
import { formatProjectPath } from './project-path.js';
import { DEFAULT_PROJECT_LINE_ORDER } from '../config.js';
import { orderFirstLineParts } from './first-line-order.js';
import { clipBranch, currentPr, formatPrBadge, getVcsDisplayState, MIN_BRANCH_CELLS, vcsLabel } from './vcs-status.js';
import { activeExtraSpend, formatExtraSpend, formatUsageFigure, hasAgeNote, usageNote } from './usage-figure.js';
import { fitsWidth, visualLength } from './visual.js';
const debug = createDebug('session-line');
const SEPARATOR = ' | ';
const MODEL_LEVELS = 3;
export function renderSessionLine(ctx, options = {}) {
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
    const fits = options.fitsRow ?? fitsWidth(options.maxWidth);
    const maxWidth = typeof options.maxWidth === 'number' && options.maxWidth > 0 ? options.maxWidth : null;
    const parts = [];
    const push = (text, key = null, kind) => parts.push({ key, text, kind });
    const contextValueMode = display?.contextValue ?? 'percent';
    const contextValueOf = (isBrief) => {
        const value = formatContextValue(ctx, percent, isBrief && contextValueMode === 'both' ? 'percent' : contextValueMode);
        return `${getContextColor(percent, colors, contextThresholds)}${value}${RESET}`;
    };
    const customLine = display?.customLine;
    const customLinePosition = display?.customLinePosition ?? 'last';
    if (customLine && customLinePosition === 'first') {
        push(customColor(customLine, colors));
    }
    const plainBadgeCtx = {
        ...ctx,
        config: { ...ctx.config, display: { ...ctx.config.display, showAuthInModel: false } },
    };
    const modelDisplays = [
        formatModelDisplay(model, ctx),
        formatModelDisplay(model, plainBadgeCtx),
        formatModelDisplay(model.replace(/\s*\([^)]*\)/g, '') || model, plainBadgeCtx),
    ];
    const modelCluster = (isBrief, level = 0) => {
        const value = contextValueOf(isBrief);
        const badge = modelColor(`[${modelDisplays[Math.min(level, modelDisplays.length - 1)]}]`, colors);
        const hasBar = display?.showContextBar !== false && level < MODEL_LEVELS;
        if (display?.showModel !== false && hasBar) {
            return `${badge} ${bar} ${value}`;
        }
        if (display?.showModel !== false) {
            return `${badge} ${value}`;
        }
        if (hasBar) {
            return `${bar} ${value}`;
        }
        return value;
    };
    push(modelCluster(false), 'model', 'model');
    let projectPart = null;
    if (display?.showProject !== false && ctx.stdin.cwd) {
        const pathLevels = ctx.config?.pathLevels ?? 1;
        const projectPath = formatProjectPath(ctx.stdin.cwd, pathLevels);
        projectPart = projectColor(projectPath, colors);
    }
    const vcs = getVcsDisplayState(ctx.gitStatus, ctx.config);
    const branchOverflow = vcs?.branchOverflow ?? ctx.config.gitStatus?.branchOverflow ?? 'truncate';
    const pr = vcs?.kind === 'git' ? currentPr(ctx.prStatus) : null;
    const gitPartOf = (detail, branchCells, isPrHidden = false) => {
        if (!vcs || detail === 'none')
            return '';
        const isClipped = detail === 'clipped';
        const gitParts = [isClipped && branchCells !== null ? clipBranch(vcs.branch, branchCells) : vcs.branch];
        if (vcs.dirty) {
            gitParts.push('*');
        }
        if (!isClipped && vcs.ahead > 0) {
            gitParts.push(` ↑${vcs.ahead}`);
        }
        if (!isClipped && vcs.behind > 0) {
            gitParts.push(` ↓${vcs.behind}`);
        }
        if (detail === 'full' && vcs.fileStats) {
            const { modified, added, deleted, untracked } = vcs.fileStats;
            const statParts = [];
            if (modified > 0)
                statParts.push(`!${modified}`);
            if (added > 0)
                statParts.push(`+${added}`);
            if (deleted > 0)
                statParts.push(`✘${deleted}`);
            if (untracked > 0)
                statParts.push(`?${untracked}`);
            if (statParts.length > 0) {
                gitParts.push(` ${statParts.join(' ')}`);
            }
        }
        const conflictPart = vcs.conflict ? ` ${critical('!conflict', colors)}` : '';
        const prPart = pr && !isPrHidden ? ` ${formatPrBadge(pr, colors, detail)}` : '';
        return `${gitColor(vcsLabel(vcs), colors)}${gitBranchColor(gitParts.join(''), colors)}${conflictPart}${gitColor(')', colors)}${prPart}`;
    };
    const fullGitPart = gitPartOf('full', null);
    if (projectPart && fullGitPart) {
        if (branchOverflow === 'wrap') {
            push(projectPart, 'project', 'project');
            push(fullGitPart, 'project', 'git');
        }
        else {
            push(`${projectPart} ${fullGitPart}`, 'project', 'projectGit');
        }
    }
    else if (projectPart) {
        push(projectPart, 'project', 'project');
    }
    else if (fullGitPart) {
        push(fullGitPart, 'project', 'git');
    }
    if (display?.agentsLine !== true) {
        const running = ctx.transcript.agents.filter((agent) => agent.status === 'running').length;
        if (running > 0) {
            push(label(`${running} ${running === 1 ? 'agent' : 'agents'}`, colors));
        }
    }
    if (display?.showSessionName && ctx.transcript.sessionName) {
        push(label(ctx.transcript.sessionName, colors), 'sessionName');
    }
    if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
        push(label(`CC v${ctx.claudeCodeVersion}`, colors), 'version');
    }
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
    const usageStyle = {
        bars: display?.usageBarEnabled ?? true,
        resetLabel: display?.showResetLabel ?? true,
        compact: display?.usageCompact ?? false,
        resetTimes: true,
        notes: true,
        extra: 'full',
    };
    const usageSteps = usageRowSteps(usageStyle);
    const usageTexts = renderUsageParts(ctx, usageStyle, barWidth);
    const isUsageOnOwnRow = display?.usageOnNewLine === true;
    const rowTwoExtras = [];
    const pushAfterUsage = (text) => {
        if (isUsageOnOwnRow) {
            rowTwoExtras.push(text);
        }
        else {
            push(text);
        }
    };
    if (!isUsageOnOwnRow && usageTexts.length > 0) {
        push(usageTexts.join(SEPARATOR), null, 'usage');
    }
    if (display?.showSessionTokens && ctx.transcript.sessionTokens) {
        const summary = formatSessionTokenSummary(ctx.transcript.sessionTokens, `${t('format.tok')}:`);
        if (summary) {
            pushAfterUsage(label(summary, colors));
        }
    }
    if (display?.showCompactions) {
        const compactions = ctx.transcript.compactionCount ?? 0;
        if (compactions > 0) {
            pushAfterUsage(label(`${t('label.compactions')}: ${compactions}`, colors));
        }
    }
    const usageParts = isUsageOnOwnRow
        ? fitUsageRow(ctx, usageTexts, rowTwoExtras, usageSteps, barWidth, fits)
        : [];
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
    const breakdown = () => {
        if (display?.showTokenBreakdown === false || percent < (display?.contextCriticalThreshold ?? 85))
            return '';
        const usage = ctx.stdin.context_window?.current_usage;
        if (!usage)
            return '';
        const input = formatTokens(usage.input_tokens ?? 0);
        const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
        return label(` (${t('format.in')}: ${input}, ${t('format.cache')}: ${cache})`, colors);
    };
    const optionalIndexes = parts.flatMap((part, index) => (part.kind === undefined ? [index] : []));
    const rowOne = (state) => {
        const hidden = new Set(state.dropped > 0 ? optionalIndexes.slice(-state.dropped) : []);
        const live = parts.flatMap((part, index) => {
            if (hidden.has(index))
                return [];
            const text = partText(part, state);
            return text ? [{ key: part.key, text }] : [];
        });
        const joined = orderFirstLineParts(live, order).join(SEPARATOR);
        return state.isContextBrief ? joined : `${joined}${breakdown()}`;
    };
    const partText = (part, state) => {
        switch (part.kind) {
            case 'model':
                return modelCluster(state.isContextBrief, state.modelLevel);
            case 'git':
                return gitPartOf(state.git, state.branchCells, state.isPrHidden);
            case 'projectGit': {
                const gitText = gitPartOf(state.git, state.branchCells, state.isPrHidden);
                return gitText ? `${projectPart ?? ''} ${gitText}` : (projectPart ?? '');
            }
            case 'usage':
                return state.usageStep === 0
                    ? part.text
                    : renderUsageParts(ctx, usageSteps[state.usageStep - 1] ?? usageStyle, barWidth).join(SEPARATOR);
            default:
                return part.text;
        }
    };
    let line = fitRowOne(rowOne, {
        fits: options.isSingleRow === false ? undefined : fits,
        maxWidth,
        optionalCount: optionalIndexes.length,
        usageStepCount: parts.some((part) => part.kind === 'usage') ? usageSteps.length : 0,
        branchCells: vcs ? visualLength(vcs.branch) : 0,
        hasGit: vcs !== null,
    });
    if (usageParts.length > 0) {
        const usageLine = usageParts.join(SEPARATOR);
        line = line.length > 0 ? `${line}\n${usageLine}` : usageLine;
    }
    return line;
}
function fitRowOne(rowOne, limits) {
    const { fits } = limits;
    let state = { dropped: 0, isContextBrief: false, modelLevel: 0, usageStep: 0, git: 'full', branchCells: null, isPrHidden: false };
    let row = rowOne(state);
    if (!fits || fits(row))
        return row;
    const attempt = (next) => {
        state = { ...state, ...next };
        row = rowOne(state);
        return fits(row);
    };
    for (let dropped = 1; dropped <= limits.optionalCount; dropped += 1) {
        if (attempt({ dropped }))
            return row;
    }
    if (attempt({ isContextBrief: true }))
        return row;
    for (let usageStep = 1; usageStep <= limits.usageStepCount; usageStep += 1) {
        if (attempt({ usageStep }))
            return row;
    }
    for (let modelLevel = 0; modelLevel <= MODEL_LEVELS && limits.hasGit; modelLevel += 1) {
        if (attempt({ modelLevel, git: 'brief', branchCells: null, isPrHidden: false }))
            return row;
        if (limits.maxWidth === null)
            continue;
        for (const isPrHidden of [false, true]) {
            const wide = rowOne({ ...state, git: 'clipped', branchCells: limits.branchCells, isPrHidden });
            const room = limits.branchCells - (visualLength(wide) - limits.maxWidth);
            if (room >= MIN_BRANCH_CELLS && attempt({ git: 'clipped', branchCells: room, isPrHidden }))
                return row;
        }
    }
    for (let modelLevel = 0; modelLevel <= MODEL_LEVELS; modelLevel += 1) {
        if (attempt({ modelLevel, git: 'none' }))
            return row;
    }
    return row;
}
function usageRowSteps(style) {
    const tight = { ...style, bars: false, resetLabel: false, compact: true };
    return [
        { ...style, bars: false },
        { ...style, bars: false, resetLabel: false },
        tight,
        { ...tight, resetTimes: false },
        { ...tight, resetTimes: false, notes: false },
        { ...tight, resetTimes: false, notes: false, extra: 'short' },
    ];
}
function renderUsageParts(ctx, style, barWidth) {
    const display = ctx.config?.display;
    const colors = ctx.config?.colors;
    const usage = ctx.usageData;
    if (display?.showUsage === false || !usage || shouldHideUsage(ctx.stdin)) {
        return [];
    }
    const parts = [];
    const push = (text) => parts.push(text);
    const timeFormat = display?.timeFormat ?? 'relative';
    const wallClockOpts = {
        hourCycle: display?.hourCycle ?? 'auto',
        showSeconds: display?.showClockSeconds ?? false,
    };
    const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
    const usageCompact = style.compact;
    const showResetLabel = style.resetLabel;
    const resetAtOf = (resetAt) => (style.resetTimes ? resetAt : null);
    const usageValueMode = display?.usageValue ?? 'percent';
    const scopedWindows = (usage.scopedWindows ?? []).filter((window) => hasFigure(window.percent));
    const fiveHour = hasFigure(usage.fiveHour) ? usage.fiveHour : null;
    const sevenDay = hasFigure(usage.sevenDay) ? usage.sevenDay : null;
    const hasWindowData = fiveHour !== null || sevenDay !== null || scopedWindows.length > 0;
    const windowPart = (spec) => usageCompact
        ? formatCompactWindowPart({
            label: spec.compactLabel ?? spec.label,
            percent: spec.percent,
            resetAt: resetAtOf(spec.resetAt),
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
            percent: spec.percent,
            resetAt: resetAtOf(spec.resetAt),
            colors,
            usageBarEnabled: style.bars,
            barWidth,
            timeFormat,
            showResetLabel,
            forceLabel: spec.forceLabel ?? true,
            usageValueMode,
            windowDurationLabel: spec.windowDurationLabel,
            wallClockOpts,
            note: spec.note ?? null,
            showNote: style.notes,
            tone: spec.tone,
        });
    const scopedPart = (window, anchorResetAt) => windowPart({
        label: window.label,
        percent: window.percent ?? 0,
        resetAt: sameResetMinute(window.resetAt, anchorResetAt) ? null : window.resetAt,
        tone: 'model',
        windowDurationLabel: '7d',
    });
    if (isLimitReached(usage)) {
        const fiveHourLimit = usage.fiveHour === 100;
        const limitResetAt = fiveHourLimit ? usage.fiveHourResetAt : usage.sevenDayResetAt;
        const resetTime = formatResetTime(resetAtOf(limitResetAt), timeFormat, fiveHourLimit ? 'short' : 'long', wallClockOpts);
        if (usageCompact) {
            push(critical(`⚠ Limit${resetTime ? ` (${resetTime})` : ''}`, colors));
        }
        else {
            const resetSuffix = resetTime
                ? showResetLabel
                    ? ` (${t(resetsKey)} ${resetTime})`
                    : ` (${resetTime})`
                : '';
            push(critical(`⚠ ${t('status.limitReached')}${resetSuffix}`, colors));
        }
        scopedWindows.forEach((window) => push(scopedPart(window, limitResetAt)));
    }
    else {
        const usageThreshold = display?.usageThreshold ?? 0;
        const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0, ...scopedWindows.map((window) => window.percent ?? 0));
        if (hasWindowData && effectiveUsage >= usageThreshold) {
            const sevenDayThreshold = display?.sevenDayThreshold ?? 0;
            const showSevenDay = sevenDay !== null && (fiveHour === null || sevenDay >= sevenDayThreshold);
            const anchorResetAt = showSevenDay ? usage.sevenDayResetAt : null;
            const windows = [];
            if (fiveHour !== null) {
                windows.push(windowPart({
                    label: '5h',
                    percent: fiveHour,
                    resetAt: usage.fiveHourResetAt,
                    note: usageNote(usage, 'fiveHour'),
                    forceLabel: false,
                }));
            }
            scopedWindows.forEach((window) => windows.push(scopedPart(window, anchorResetAt)));
            if (showSevenDay && sevenDay !== null) {
                windows.push(windowPart({
                    label: t('label.weekly'),
                    compactLabel: '7d',
                    percent: sevenDay,
                    resetAt: usage.sevenDayResetAt,
                    note: usageNote(usage, 'sevenDay'),
                }));
            }
            const isLabelled = !usageCompact && (fiveHour !== null || !showSevenDay);
            windows.forEach((part, index) => push(index === 0 && isLabelled ? `${label(t('label.usage'), colors)} ${part}` : part));
        }
    }
    if (usage.balanceLabel) {
        if (!hasWindowData) {
            push(`${label(t('label.usage'), colors)} ${usage.balanceLabel}`);
        }
        else {
            push(usage.balanceLabel);
        }
    }
    const spend = style.extra === 'none' ? null : activeExtraSpend(usage);
    if (spend && style.extra !== 'none') {
        push(formatExtraSpend(spend, colors, style.extra));
    }
    if (usage.staleSince && parts.length > 0 && !hasAgeNote(usage)) {
        push(formatStaleUsageMarker(usage.staleSince, colors));
    }
    return parts;
}
function fitUsageRow(ctx, usageTexts, extras, steps, barWidth, fits) {
    const row = [...usageTexts, ...extras];
    if (!fits || row.length === 0 || fits(row.join(SEPARATOR))) {
        return row;
    }
    if (usageTexts.length === 0) {
        return row;
    }
    let fitted = row;
    for (const step of steps) {
        fitted = [...renderUsageParts(ctx, step, barWidth), ...extras];
        if (fits(fitted.join(SEPARATOR))) {
            return fitted;
        }
    }
    for (let kept = extras.length - 1; kept >= 0; kept -= 1) {
        fitted = [...fitted.slice(0, fitted.length - 1)];
        if (fits(fitted.join(SEPARATOR))) {
            break;
        }
    }
    return fitted;
}
function formatCompactWindowPart(options) {
    const { label: windowLabel, percent, resetAt, timeFormat, colors, usageValueMode, wallClockOpts, note, showNote, tone } = options;
    const usageDisplay = formatUsageFigure(percent, { colors, mode: usageValueMode, note, showNote, tone });
    const reset = formatResetTime(resetAt, timeFormat, windowLabel === '5h' ? 'short' : 'long', wallClockOpts);
    const styledLabel = label(`${windowLabel}:`, colors);
    return reset
        ? `${styledLabel} ${usageDisplay} ${label(`(${reset})`, colors)}`
        : `${styledLabel} ${usageDisplay}`;
}
function formatUsageWindowPart(options) {
    const { label: windowLabel, percent, resetAt, colors, usageBarEnabled, barWidth, timeFormat, showResetLabel, forceLabel, usageValueMode, windowDurationLabel, wallClockOpts, note, showNote, tone } = options;
    const usageDisplay = formatUsageFigure(percent, { colors, mode: usageValueMode, note, showNote, tone });
    const reset = formatResetTime(resetAt, timeFormat, windowLabel === '5h' ? 'short' : 'long', wallClockOpts);
    const styledLabel = label(windowLabel, colors);
    const resetsKey = timeFormat === 'absolute' ? 'format.resets' : 'format.resetsIn';
    if (usageBarEnabled) {
        const barReset = timeFormat === 'relative'
            ? (reset ? `${reset} / ${windowDurationLabel ?? windowLabel}` : null)
            : (reset ? (showResetLabel ? `${t(resetsKey)} ${reset}` : reset) : null);
        const bar = quotaBar(percent, barWidth, colors, tone);
        const body = barReset
            ? `${bar} ${usageDisplay} ${label(`(${barReset})`, colors)}`
            : `${bar} ${usageDisplay}`;
        return forceLabel ? `${styledLabel} ${body}` : body;
    }
    const resetSuffix = reset
        ? showResetLabel
            ? `(${t(resetsKey)} ${reset})`
            : `(${reset})`
        : '';
    return resetSuffix
        ? `${styledLabel} ${usageDisplay} ${label(resetSuffix, colors)}`
        : `${styledLabel} ${usageDisplay}`;
}
//# sourceMappingURL=session-line.js.map