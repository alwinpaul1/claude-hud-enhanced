import { isLimitReached } from '../types.js';
import { getContextPercent, getBufferedPercent, getModelName, formatModelName, getProviderLabel, getTotalTokens } from '../stdin.js';
import { getOutputSpeed } from '../speed-tracker.js';
import { coloredBar, critical, git as gitColor, gitBranch as gitBranchColor, label, model as modelColor, project as projectColor, getContextColor, getQuotaColor, quotaBar, custom as customColor, RESET } from './colors.js';
import { getAdaptiveBarWidth } from '../utils/terminal.js';
import { renderCostEstimate } from './lines/cost.js';
import { t } from '../i18n/index.js';
const DEBUG = process.env.DEBUG?.includes('claude-hud') || process.env.DEBUG === '*';
/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode.
 */
export function renderSessionLine(ctx) {
    const model = formatModelName(getModelName(ctx.stdin), ctx.config?.display?.modelFormat, ctx.config?.display?.modelOverride);
    const rawPercent = getContextPercent(ctx.stdin);
    const bufferedPercent = getBufferedPercent(ctx.stdin);
    const autocompactMode = ctx.config?.display?.autocompactBuffer ?? 'enabled';
    const percent = autocompactMode === 'disabled' ? rawPercent : bufferedPercent;
    if (DEBUG && autocompactMode === 'disabled') {
        console.error(`[claude-hud:context] autocompactBuffer=disabled, showing raw ${rawPercent}% (buffered would be ${bufferedPercent}%)`);
    }
    const colors = ctx.config?.colors;
    const barWidth = getAdaptiveBarWidth();
    const bar = coloredBar(percent, barWidth, colors);
    const parts = [];
    const display = ctx.config?.display;
    const contextValueMode = display?.contextValue ?? 'percent';
    const contextValue = formatContextValue(ctx, percent, contextValueMode);
    const contextValueDisplay = `${getContextColor(percent, colors)}${contextValue}${RESET}`;
    // Model and context bar (FIRST)
    const providerLabel = getProviderLabel(ctx.stdin);
    const planLabel = display?.showPlan !== false && !display?.modelOverride ? ctx.planLabel : null;
    const qualifiers = [providerLabel, planLabel].filter((q) => !!q);
    const modelDisplay = qualifiers.length > 0 ? `${model} | ${qualifiers.join(' | ')}` : model;
    if (display?.showModel !== false && display?.showContextBar !== false) {
        parts.push(`${modelColor(`[${modelDisplay}]`, colors)} ${bar} ${contextValueDisplay}`);
    }
    else if (display?.showModel !== false) {
        parts.push(`${modelColor(`[${modelDisplay}]`, colors)} ${contextValueDisplay}`);
    }
    else if (display?.showContextBar !== false) {
        parts.push(`${bar} ${contextValueDisplay}`);
    }
    else {
        parts.push(contextValueDisplay);
    }
    // Project path + git status (SECOND)
    let projectPart = null;
    if (display?.showProject !== false && ctx.stdin.cwd) {
        // Split by both Unix (/) and Windows (\) separators for cross-platform support
        const segments = ctx.stdin.cwd.split(/[/\\]/).filter(Boolean);
        const pathLevels = ctx.config?.pathLevels ?? 1;
        // Always join with forward slash for consistent display
        // Handle root path (/) which results in empty segments
        const projectPath = segments.length > 0 ? segments.slice(-pathLevels).join('/') : '/';
        projectPart = projectColor(projectPath, colors);
    }
    let gitPart = '';
    const gitConfig = ctx.config?.gitStatus;
    const showGit = gitConfig?.enabled ?? true;
    if (showGit && ctx.gitStatus) {
        const gitParts = [ctx.gitStatus.branch];
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
        gitPart = `${gitColor('git:(', colors)}${gitBranchColor(gitParts.join(''), colors)}${gitColor(')', colors)}`;
    }
    if (projectPart && gitPart) {
        parts.push(`${projectPart} ${gitPart}`);
    }
    else if (projectPart) {
        parts.push(projectPart);
    }
    else if (gitPart) {
        parts.push(gitPart);
    }
    // Session name (custom title from /rename, or auto-generated slug)
    if (display?.showSessionName && ctx.transcript.sessionName) {
        parts.push(label(ctx.transcript.sessionName, colors));
    }
    if (display?.showClaudeCodeVersion && ctx.claudeCodeVersion) {
        parts.push(label(`CC v${ctx.claudeCodeVersion}`, colors));
    }
    // Config counts (respects environmentThreshold + per-type toggles)
    {
        const totalCounts = ctx.claudeMdCount + ctx.rulesCount + ctx.mcpCount + ctx.hooksCount;
        const envThreshold = display?.environmentThreshold ?? 0;
        const showAll = display?.showConfigCounts === true;
        const showClaudeMd = showAll || display?.showClaudeMdCount === true;
        const showRules = showAll || display?.showRulesCount === true;
        const showMcp = showAll || display?.showMcpCount !== false;
        const showHooks = showAll || display?.showHooksCount !== false;
        if (totalCounts > 0 && totalCounts >= envThreshold) {
            if (showClaudeMd && ctx.claudeMdCount > 0) {
                parts.push(label(`${ctx.claudeMdCount} CLAUDE.md`, colors));
            }
            if (showRules && ctx.rulesCount > 0) {
                parts.push(label(`${ctx.rulesCount} ${t('label.rules')}`, colors));
            }
            if (showMcp && ctx.mcpCount > 0) {
                parts.push(label(`${ctx.mcpCount} MCPs`, colors));
            }
            if (showHooks && ctx.hooksCount > 0) {
                parts.push(label(`${ctx.hooksCount} ${t('label.hooks')}`, colors));
            }
        }
    }
    // Usage limits display (shown when enabled in config, respects usageThreshold)
    if (display?.showUsage !== false && ctx.usageData && !providerLabel) {
        if (isLimitReached(ctx.usageData)) {
            const fiveHourReached = ctx.usageData.fiveHour === 100;
            const sevenDayReached = ctx.usageData.sevenDay === 100;
            const resetTime = fiveHourReached
                ? formatResetTimeOfDay(ctx.usageData.fiveHourResetAt)
                : formatResetDateTime(ctx.usageData.sevenDayResetAt);
            parts.push(critical(`⚠ ${t('status.limitReached')}${resetTime ? ` (${t('format.resets')} ${resetTime})` : ''}`, colors));
            // Still surface the other window so users know their weekly standing
            const usageBarEnabled = display?.usageBarEnabled ?? true;
            if (fiveHourReached && !sevenDayReached && ctx.usageData.sevenDay !== null) {
                parts.push(formatUsageWindowPart({
                    label: t('label.weekly'),
                    percent: ctx.usageData.sevenDay,
                    resetAt: ctx.usageData.sevenDayResetAt,
                    colors,
                    usageBarEnabled,
                    barWidth,
                    forceLabel: true,
                    resetStyle: 'datetime',
                }));
            }
        }
        else {
            const usageThreshold = display?.usageThreshold ?? 0;
            const fiveHour = ctx.usageData.fiveHour;
            const sevenDay = ctx.usageData.sevenDay;
            const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
            if (effectiveUsage >= usageThreshold) {
                const usageBarEnabled = display?.usageBarEnabled ?? true;
                if (fiveHour === null && sevenDay !== null) {
                    const weeklyOnlyPart = formatUsageWindowPart({
                        label: t('label.weekly'),
                        percent: sevenDay,
                        resetAt: ctx.usageData.sevenDayResetAt,
                        colors,
                        usageBarEnabled,
                        barWidth,
                        forceLabel: true,
                        resetStyle: 'datetime',
                    });
                    parts.push(weeklyOnlyPart);
                }
                else {
                    const fiveHourPart = formatUsageWindowPart({
                        label: '5h',
                        percent: fiveHour,
                        resetAt: ctx.usageData.fiveHourResetAt,
                        colors,
                        usageBarEnabled,
                        barWidth,
                        resetStyle: 'time',
                    });
                    const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
                    if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
                        const sevenDayPart = formatUsageWindowPart({
                            label: t('label.weekly'),
                            percent: sevenDay,
                            resetAt: ctx.usageData.sevenDayResetAt,
                            colors,
                            usageBarEnabled,
                            barWidth,
                            forceLabel: true,
                            resetStyle: 'datetime',
                        });
                        parts.push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
                        parts.push(sevenDayPart);
                    }
                    else {
                        parts.push(`${label(t('label.usage'), colors)} ${fiveHourPart}`);
                    }
                }
            }
        }
    }
    // Session token usage (cumulative)
    if (display?.showSessionTokens && ctx.transcript.sessionTokens) {
        const st = ctx.transcript.sessionTokens;
        const total = st.inputTokens + st.outputTokens + st.cacheCreationTokens + st.cacheReadTokens;
        if (total > 0) {
            parts.push(label(`tok: ${formatTokens(total)}`, colors));
        }
    }
    // Session duration
    if (display?.showSpeed) {
        const speed = getOutputSpeed(ctx.stdin);
        if (speed !== null) {
            parts.push(label(`${t('format.out')}: ${speed.toFixed(1)} ${t('format.tokPerSec')}`, colors));
        }
    }
    if (display?.showDuration !== false && ctx.sessionDuration) {
        parts.push(label(`⏱️  ${ctx.sessionDuration}`, colors));
    }
    const costEstimate = renderCostEstimate(ctx);
    if (costEstimate) {
        parts.push(costEstimate);
    }
    if (ctx.extraLabel) {
        parts.push(label(ctx.extraLabel, colors));
    }
    // Custom line (static user-defined text)
    const customLine = display?.customLine;
    if (customLine) {
        parts.push(customColor(customLine, colors));
    }
    let line = parts.join(' | ');
    // Token breakdown at high context
    if (display?.showTokenBreakdown !== false && percent >= 85) {
        const usage = ctx.stdin.context_window?.current_usage;
        if (usage) {
            const input = formatTokens(usage.input_tokens ?? 0);
            const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
            line += label(` (${t('format.in')}: ${input}, ${t('format.cache')}: ${cache})`, colors);
        }
    }
    return line;
}
function formatTokens(n) {
    if (n >= 1000000) {
        return `${(n / 1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
        return `${(n / 1000).toFixed(0)}k`;
    }
    return n.toString();
}
function formatContextValue(ctx, percent, mode) {
    const totalTokens = getTotalTokens(ctx.stdin);
    const size = ctx.stdin.context_window?.context_window_size ?? 0;
    if (mode === 'tokens') {
        if (size > 0) {
            return `${formatTokens(totalTokens)}/${formatTokens(size)}`;
        }
        return formatTokens(totalTokens);
    }
    if (mode === 'both') {
        if (size > 0) {
            return `${percent}% (${formatTokens(totalTokens)}/${formatTokens(size)})`;
        }
        return `${percent}%`;
    }
    if (mode === 'remaining') {
        return `${Math.max(0, 100 - percent)}%`;
    }
    return `${percent}%`;
}
function formatUsagePercent(percent, colors) {
    if (percent === null) {
        return label('--', colors);
    }
    const color = getQuotaColor(percent, colors);
    return `${color}${percent}%${RESET}`;
}
function formatUsageWindowPart({ label: windowLabel, percent, resetAt, colors, usageBarEnabled, barWidth, forceLabel = false, resetStyle = 'countdown', }) {
    const usageDisplay = formatUsagePercent(percent, colors);
    const reset = resetStyle === 'datetime'
        ? formatResetDateTime(resetAt)
        : resetStyle === 'time'
            ? formatResetTimeOfDay(resetAt)
            : formatResetTime(resetAt);
    const styledLabel = label(windowLabel, colors);
    if (usageBarEnabled) {
        const suffix = resetStyle === 'datetime' || resetStyle === 'time'
            ? `(${t('format.resets')} ${reset})`
            : `(${reset})`;
        const body = reset
            ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay} ${suffix}`
            : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}`;
        return forceLabel ? `${styledLabel} ${body}` : body;
    }
    const prefix = resetStyle === 'datetime' || resetStyle === 'time'
        ? t('format.resets')
        : t('format.resetsIn');
    return reset
        ? `${styledLabel} ${usageDisplay} (${prefix} ${reset})`
        : `${styledLabel} ${usageDisplay}`;
}
function formatResetDateTime(resetAt) {
    if (!resetAt)
        return '';
    const now = new Date();
    if (resetAt.getTime() <= now.getTime())
        return '';
    const weekday = resetAt.toLocaleDateString('en-US', { weekday: 'short' });
    const time = resetAt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
    return `${weekday} ${time}`;
}
function formatResetTimeOfDay(resetAt) {
    if (!resetAt)
        return '';
    const now = new Date();
    if (resetAt.getTime() <= now.getTime())
        return '';
    return resetAt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
}
function formatResetTime(resetAt) {
    if (!resetAt)
        return '';
    const now = new Date();
    const diffMs = resetAt.getTime() - now.getTime();
    if (diffMs <= 0)
        return '';
    const diffMins = Math.ceil(diffMs / 60000);
    if (diffMins < 60)
        return `${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        if (remHours > 0)
            return `${days}d ${remHours}h`;
        return `${days}d`;
    }
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
//# sourceMappingURL=session-line.js.map