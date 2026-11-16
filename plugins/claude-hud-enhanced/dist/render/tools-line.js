import { yellow, green, cyan, label } from './colors.js';
import { firstFitting } from './visual.js';
const ELLIPSIS = '…';
const MCP_TOOL_NAME_PATTERN = /^mcp__(.+?)__(.+)$/;
const RUNNING_SHOWN = 2;
export function shortenMcpServer(server) {
    const hosted = server.replace(/^claude[-_]in[-_]/i, '').replace(/^claude[-_]ai[-_]/i, '');
    if (!hosted.startsWith('plugin_')) {
        return hosted;
    }
    const rest = hosted.slice('plugin_'.length);
    const tokens = rest.split('_');
    for (let cut = 1; cut < tokens.length; cut += 1) {
        const plugin = tokens.slice(0, cut).join('_');
        const own = tokens.slice(cut).join('_');
        if (own === plugin || own.startsWith(`${plugin}-`) || own.startsWith(`${plugin}_`)) {
            return own;
        }
    }
    return rest;
}
export function compactToolName(name) {
    const mcp = MCP_TOOL_NAME_PATTERN.exec(name);
    if (!mcp) {
        return name;
    }
    const [, server = '', tool = ''] = mcp;
    return `${shortenMcpServer(server)}:${tool}`;
}
export function shortenToolName(name, maxLen) {
    if (maxLen === 0) {
        return compactToolName(name);
    }
    const displayName = MCP_TOOL_NAME_PATTERN.test(name)
        ? (name.split('__').pop() ?? name)
        : name;
    if (displayName.length <= maxLen) {
        return displayName;
    }
    return `${displayName.slice(0, Math.max(0, maxLen - 1))}${ELLIPSIS}`;
}
export function renderToolsLine(ctx, fits) {
    const hideSkillTools = ctx.config?.display?.showSkills === true;
    const tools = hideSkillTools
        ? ctx.transcript.tools.filter((tool) => tool.name !== 'Skill')
        : ctx.transcript.tools;
    const colors = ctx.config?.colors;
    const toolNameMaxLength = ctx.config?.display?.toolNameMaxLength ?? 0;
    const toolsMaxVisible = ctx.config?.display?.toolsMaxVisible ?? 4;
    if (tools.length === 0) {
        return null;
    }
    const runningTools = tools.filter((t) => t.status === 'running').slice(-RUNNING_SHOWN);
    const completedTools = tools.filter((t) => t.status === 'completed' || t.status === 'error');
    const runningParts = (withTargets, shown) => runningTools.slice(-shown).map((tool) => {
        const target = withTargets && tool.target ? truncatePath(tool.target) : '';
        const name = shortenToolName(tool.name, toolNameMaxLength);
        return `${yellow('◐')} ${cyan(name)}${target ? label(`: ${target}`, colors) : ''}`;
    });
    const toolCounts = new Map();
    for (const tool of completedTools) {
        toolCounts.set(tool.name, (toolCounts.get(tool.name) ?? 0) + 1);
    }
    const sortedTools = Array.from(toolCounts.entries())
        .sort((a, b) => b[1] - a[1]);
    const maxVisible = toolsMaxVisible === 0 ? sortedTools.length : Math.min(toolsMaxVisible, sortedTools.length);
    const completedParts = (visible) => {
        const shown = sortedTools
            .slice(0, visible)
            .map(([name, count]) => `${green('✓')} ${shortenToolName(name, toolNameMaxLength)} ${label(`×${count}`, colors)}`);
        const hidden = sortedTools.length - visible;
        if (hidden <= 0)
            return shown;
        return [...shown, label(visible === 0 && runningTools.length === 0 ? `${hidden} tools` : `+${hidden} more`, colors)];
    };
    if (runningTools.length === 0 && sortedTools.length === 0) {
        return null;
    }
    const candidates = [];
    for (let visible = maxVisible; visible >= 0; visible -= 1) {
        candidates.push(() => [...runningParts(true, RUNNING_SHOWN), ...completedParts(visible)].join(' | '));
    }
    candidates.push(() => [...runningParts(false, RUNNING_SHOWN), ...completedParts(0)].join(' | '));
    candidates.push(() => [...runningParts(false, 1), ...completedParts(0)].join(' | '));
    if (runningTools.length > 0) {
        candidates.push(() => runningParts(false, 1).join(' | '));
    }
    candidates.push(() => label(`${runningTools.length + sortedTools.length} tools`, colors));
    return firstFitting(candidates, fits);
}
function truncatePath(path, maxLen = 20) {
    // Normalize Windows backslashes to forward slashes for consistent display
    const normalizedPath = path.replace(/\\/g, '/');
    if (normalizedPath.length <= maxLen)
        return normalizedPath;
    // Split by forward slash (already normalized)
    const parts = normalizedPath.split('/');
    const filename = parts.pop() || normalizedPath;
    if (filename.length >= maxLen) {
        return filename.slice(0, maxLen - 3) + '...';
    }
    return '.../' + filename;
}
//# sourceMappingURL=tools-line.js.map