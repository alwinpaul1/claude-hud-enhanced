import { DEFAULT_ELEMENT_ORDER, DEFAULT_MERGE_GROUPS } from '../config.js';
import { renderSessionLine } from './session-line.js';
import { renderToolsLine } from './tools-line.js';
import { renderSkillsLine, renderMcpLine } from './skills-mcp-line.js';
import { renderAgentsLine } from './agents-line.js';
import { renderTodosLine } from './todos-line.js';
import { renderIdentityLine, renderProjectLine, renderAddedDirsLine, renderGitFilesLine, renderEnvironmentLine, renderPromptCacheLine, renderUsageLine, renderMemoryLine, renderSessionTokensLine, renderCompactionsLine, renderSessionTimeLine, } from './lines/index.js';
import { dim, RESET } from './colors.js';
import { renderPillLines } from './pills.js';
import { getTerminalWidth, UNKNOWN_TERMINAL_WIDTH } from '../utils/terminal.js';
import { isCjkAmbiguousWide } from './width.js';
import { ANSI_ESCAPE_PATTERN, clipToWidth, fitsWidth, stripAnsi, truncateToWidth, visualLength } from './visual.js';
function splitLineBySeparators(line) {
    const segments = [];
    const separators = [];
    let currentStart = 0;
    let i = 0;
    while (i < line.length) {
        const ansiMatch = ANSI_ESCAPE_PATTERN.exec(line.slice(i));
        if (ansiMatch) {
            i += ansiMatch[0].length;
            continue;
        }
        const separator = line.startsWith(' | ', i)
            ? ' | '
            : (line.startsWith(' │ ', i) ? ' │ ' : null);
        if (separator) {
            segments.push(line.slice(currentStart, i));
            separators.push(separator);
            i += separator.length;
            currentStart = i;
            continue;
        }
        i += 1;
    }
    segments.push(line.slice(currentStart));
    return { segments, separators };
}
function splitWrapParts(line) {
    const { segments, separators } = splitLineBySeparators(line);
    if (segments.length === 0) {
        return [];
    }
    let parts = [{
            separator: '',
            segment: segments[0],
        }];
    for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
        parts.push({
            separator: separators[segmentIndex - 1] ?? ' | ',
            segment: segments[segmentIndex],
        });
    }
    // Keep the leading [model | provider] block together.
    // This avoids splitting inside the model badge while still splitting
    // separators elsewhere in the line.
    const firstVisible = stripAnsi(parts[0].segment).trimStart();
    const firstHasOpeningBracket = firstVisible.startsWith('[');
    const firstHasClosingBracket = stripAnsi(parts[0].segment).includes(']');
    if (firstHasOpeningBracket && !firstHasClosingBracket && parts.length > 1) {
        let mergedSegment = parts[0].segment;
        let consumeIndex = 1;
        while (consumeIndex < parts.length) {
            const nextPart = parts[consumeIndex];
            mergedSegment += `${nextPart.separator}${nextPart.segment}`;
            consumeIndex += 1;
            if (stripAnsi(nextPart.segment).includes(']')) {
                break;
            }
        }
        parts = [
            { separator: '', segment: mergedSegment },
            ...parts.slice(consumeIndex),
        ];
    }
    return parts;
}
function wrapLineToWidth(line, maxWidth) {
    if (maxWidth <= 0 || visualLength(line) <= maxWidth) {
        return [line];
    }
    const parts = splitWrapParts(line);
    if (parts.length <= 1) {
        return [truncateToWidth(line, maxWidth)];
    }
    const wrapped = [];
    let current = parts[0].segment;
    for (const part of parts.slice(1)) {
        const candidate = `${current}${part.separator}${part.segment}`;
        if (visualLength(candidate) <= maxWidth) {
            current = candidate;
            continue;
        }
        wrapped.push(truncateToWidth(current, maxWidth));
        current = part.segment;
    }
    if (current) {
        wrapped.push(truncateToWidth(current, maxWidth));
    }
    return wrapped;
}
// `length` is a target visual width in cells.
// `─` (U+2500) is East Asian Ambiguous-width: rendered as 2 cells in CJK
// terminals and 1 cell elsewhere. Repeating it `length` times in CJK mode
// would double the visual width and force the terminal to wrap.
function makeSeparator(length) {
    const cellsPerDash = isCjkAmbiguousWide() ? 2 : 1;
    const repeats = Math.max(1, Math.floor(length / cellsPerDash));
    return dim('─'.repeat(repeats));
}
const ACTIVITY_ELEMENTS = new Set(['tools', 'skills', 'mcp', 'agents', 'todos']);
function buildMergeGroupLookup(mergeGroups) {
    const lookup = new Map();
    for (const group of mergeGroups) {
        const groupSet = new Set(group);
        for (const element of group) {
            if (!lookup.has(element)) {
                lookup.set(element, groupSet);
            }
        }
    }
    return lookup;
}
function collectMergeSequence(elementOrder, startIndex, seen, group) {
    const sequence = [];
    for (let index = startIndex; index < elementOrder.length; index += 1) {
        const element = elementOrder[index];
        if (seen.has(element) || !group.has(element)) {
            break;
        }
        sequence.push(element);
    }
    return sequence;
}
// Treat the first configured element as the start of an order-preserving
// right zone, padding the gap before it with spaces. Returns null when alignment does
// not apply — no configured elements on either side, or not enough room for
// at least one space between the two halves — so the caller falls back to the
// normal separator join.
function alignGroupRight(entries, rightAlign, terminalWidth) {
    if (rightAlign.size === 0) {
        return null;
    }
    const splitIndex = entries.findIndex(({ element }) => rightAlign.has(element));
    if (splitIndex <= 0) {
        return null;
    }
    const leftEntries = entries.slice(0, splitIndex);
    const rightEntries = entries.slice(splitIndex);
    if (leftEntries.length === 0 || rightEntries.length === 0) {
        return null;
    }
    const leftText = leftEntries.map(({ line }) => line).join(' │ ');
    const rightText = rightEntries.map(({ line }) => line).join(' │ ');
    const gap = terminalWidth - visualLength(leftText) - visualLength(rightText);
    if (gap < 1) {
        return null;
    }
    return `${leftText}${' '.repeat(gap)}${rightText}`;
}
function fitActivityLine(line, width) {
    if (line === null || width === null || width <= 0) {
        return line;
    }
    return line.split('\n').map((row) => clipToWidth(row, width)).join('\n');
}
function collectActivityLines(ctx, skipAgents = false, width = null) {
    const display = ctx.config?.display;
    const fits = fitsWidth(width);
    const candidates = [
        display?.toolsLine === true ? renderToolsLine(ctx, fits) : null,
        display?.showSkills === true ? renderSkillsLine(ctx) : null,
        display?.showMcp === true ? renderMcpLine(ctx) : null,
        display?.agentsLine === true && !skipAgents ? renderAgentsLine(ctx, fits) : null,
        display?.todosLine === true ? renderTodosLine(ctx, fits) : null,
    ];
    return candidates.flatMap((line) => {
        const fitted = fitActivityLine(line, width);
        return fitted ? [fitted] : [];
    });
}
function renderElementLine(ctx, element, labelOptions = {}, width = null) {
    const display = ctx.config?.display;
    const fits = fitsWidth(width);
    switch (element) {
        case 'project':
            return renderProjectLine(ctx, width);
        case 'addedDirs':
            return renderAddedDirsLine(ctx);
        case 'context':
            return renderIdentityLine(ctx, labelOptions);
        case 'usage':
            return renderUsageLine(ctx, labelOptions, fits);
        case 'promptCache':
            return renderPromptCacheLine(ctx);
        case 'memory':
            return renderMemoryLine(ctx, labelOptions);
        case 'environment':
            return renderEnvironmentLine(ctx);
        case 'tools':
            return display?.toolsLine === true ? fitActivityLine(renderToolsLine(ctx, fits), width) : null;
        case 'skills':
            return display?.showSkills === true ? fitActivityLine(renderSkillsLine(ctx), width) : null;
        case 'mcp':
            return display?.showMcp === true ? fitActivityLine(renderMcpLine(ctx), width) : null;
        case 'agents':
            return display?.agentsLine === true ? fitActivityLine(renderAgentsLine(ctx, fits), width) : null;
        case 'todos':
            return display?.todosLine === true ? fitActivityLine(renderTodosLine(ctx, fits), width) : null;
        case 'sessionTime':
            return renderSessionTimeLine(ctx);
    }
}
function renderCompact(ctx, maxWidth, isSingleRow) {
    const lines = [];
    const sessionLine = renderSessionLine(ctx, { maxWidth, isSingleRow });
    if (sessionLine) {
        lines.push(sessionLine);
    }
    return lines;
}
function renderExpanded(ctx, terminalWidth = null) {
    const elementOrder = ctx.config?.elementOrder ?? DEFAULT_ELEMENT_ORDER;
    const mergeGroups = ctx.config?.display?.mergeGroups ?? DEFAULT_MERGE_GROUPS;
    const mergeGroupLookup = buildMergeGroupLookup(mergeGroups);
    const rightAlign = new Set(ctx.config?.display?.rightAlign ?? []);
    const memoryLineVisible = elementOrder.includes('memory')
        && ctx.config?.display?.showMemoryUsage === true
        && ctx.memoryUsage != null;
    const otherProgressLineVisible = elementOrder.includes('context')
        || (elementOrder.includes('usage') && renderUsageLine(ctx) != null);
    const separateMemoryLabelOptions = memoryLineVisible
        && otherProgressLineVisible
        ? { align: true, includeMemoryInWidth: true }
        : undefined;
    const seen = new Set();
    const lines = [];
    for (let index = 0; index < elementOrder.length; index += 1) {
        const element = elementOrder[index];
        if (seen.has(element)) {
            continue;
        }
        const mergeGroup = mergeGroupLookup.get(element);
        if (mergeGroup) {
            const mergeSequence = collectMergeSequence(elementOrder, index, seen, mergeGroup);
            if (mergeSequence.length > 1) {
                index += mergeSequence.length - 1;
                for (const groupedElement of mergeSequence) {
                    seen.add(groupedElement);
                }
                // A memory label only needs to influence a group's padding when its
                // progress bar is rendered on a different row. If memory is part of
                // this combined row, keep the candidate compact and align only if the
                // row is later forced to stack.
                const groupLabelOptions = memoryLineVisible && !mergeSequence.includes('memory')
                    ? separateMemoryLabelOptions
                    : undefined;
                const renderedGroupLines = mergeSequence
                    .map(groupedElement => ({
                    element: groupedElement,
                    line: renderElementLine(ctx, groupedElement, groupLabelOptions),
                }))
                    .filter((entry) => typeof entry.line === 'string' && entry.line.length > 0);
                if (renderedGroupLines.length > 1) {
                    const combinedLine = renderedGroupLines.map(({ line }) => line).join(' │ ');
                    const widthIsReal = terminalWidth !== UNKNOWN_TERMINAL_WIDTH;
                    // The fit check uses the unpadded join: right-alignment only inserts
                    // spaces, so it never changes whether the content itself fits.
                    const canCombine = !widthIsReal || visualLength(combinedLine) <= terminalWidth;
                    const alignedLine = widthIsReal
                        ? alignGroupRight(renderedGroupLines, rightAlign, terminalWidth)
                        : null;
                    if (canCombine) {
                        lines.push({
                            line: alignedLine ?? combinedLine,
                            isActivity: renderedGroupLines.some(({ element: groupedElement }) => ACTIVITY_ELEMENTS.has(groupedElement)),
                        });
                    }
                    else {
                        for (const { element: groupedElement, line } of renderedGroupLines) {
                            const stackedLine = renderElementLine(ctx, groupedElement, {
                                align: true,
                                includeMemoryInWidth: memoryLineVisible,
                            }, terminalWidth) ?? line;
                            lines.push({
                                line: stackedLine,
                                isActivity: ACTIVITY_ELEMENTS.has(groupedElement),
                            });
                        }
                    }
                }
                else if (renderedGroupLines.length === 1) {
                    const [{ element: groupedElement, line }] = renderedGroupLines;
                    const separateLine = renderElementLine(ctx, groupedElement, separateMemoryLabelOptions, terminalWidth) ?? line;
                    lines.push({
                        line: separateLine,
                        isActivity: ACTIVITY_ELEMENTS.has(groupedElement),
                    });
                }
                continue;
            }
        }
        seen.add(element);
        const line = renderElementLine(ctx, element, separateMemoryLabelOptions, terminalWidth);
        if (!line) {
            continue;
        }
        lines.push({
            line,
            isActivity: ACTIVITY_ELEMENTS.has(element),
        });
    }
    // Git files line always goes last (pass width so it can hide itself if too narrow)
    const gitFilesLine = renderGitFilesLine(ctx, terminalWidth);
    if (gitFilesLine) {
        lines.push({ line: gitFilesLine, isActivity: false });
    }
    return lines;
}
export function render(ctx, 
// Output seam for the warm daemon (captures lines instead of printing);
// every existing caller keeps the console default.
write = (line) => console.log(line)) {
    const lineLayout = ctx.config?.lineLayout ?? 'expanded';
    const showSeparators = ctx.config?.showSeparators ?? false;
    const detectedWidth = getTerminalWidth({ preferEnv: true, fallback: UNKNOWN_TERMINAL_WIDTH });
    const configuredMaxWidth = ctx.config?.maxWidth ?? UNKNOWN_TERMINAL_WIDTH;
    const terminalWidth = ctx.config?.forceMaxWidth && configuredMaxWidth !== UNKNOWN_TERMINAL_WIDTH
        ? configuredMaxWidth
        : (detectedWidth ?? configuredMaxWidth ?? UNKNOWN_TERMINAL_WIDTH);
    let lines;
    if (lineLayout === 'expanded') {
        const renderedLines = renderExpanded(ctx, terminalWidth);
        lines = renderedLines.map(({ line }) => line);
        // Session token usage (cumulative)
        if (ctx.config?.display?.showSessionTokens) {
            const sessionTokensLine = renderSessionTokensLine(ctx);
            if (sessionTokensLine) {
                lines.push(sessionTokensLine);
            }
        }
        // Compaction count (opt-in, hidden until the first compaction)
        const compactionsLine = renderCompactionsLine(ctx);
        if (compactionsLine) {
            lines.push(compactionsLine);
        }
        // Advisor is rendered inline on the project line; see renderProjectLine.
        if (showSeparators) {
            const firstActivityIndex = renderedLines.findIndex(({ isActivity }) => isActivity);
            if (firstActivityIndex > 0) {
                const separatorBaseWidth = Math.max(...renderedLines
                    .slice(0, firstActivityIndex)
                    .map(({ line }) => visualLength(line)), 20);
                const separatorWidth = terminalWidth
                    ? Math.min(separatorBaseWidth, terminalWidth)
                    : separatorBaseWidth;
                lines.splice(firstActivityIndex, 0, makeSeparator(separatorWidth));
            }
        }
    }
    else if (lineLayout === 'pills') {
        const pillWidth = terminalWidth !== UNKNOWN_TERMINAL_WIDTH ? (terminalWidth ?? 0) : 0;
        lines = [
            ...renderPillLines(ctx, pillWidth > 0 ? pillWidth : null),
            ...collectActivityLines(ctx, (ctx.pillAgents?.length ?? 0) > 0, pillWidth > 0 ? pillWidth : null),
        ];
    }
    else {
        // With `display.compactSingleRow`, keep the header a tight session + usage
        // pair: each header line (the session line and the usage line) stays a single
        // physical row — overflow is dropped at a segment boundary instead of
        // wrapping onto a third row. Activity lines below always wrap normally.
        const singleRow = ctx.config?.display?.compactSingleRow === true;
        const compactWidth = terminalWidth !== UNKNOWN_TERMINAL_WIDTH ? (terminalWidth ?? 0) : 0;
        const fitWidth = compactWidth > 0 ? compactWidth : null;
        const headerLines = singleRow
            ? renderCompact(ctx, fitWidth, true)
                .flatMap(line => line.split('\n'))
                .map(line => wrapLineToWidth(line, compactWidth)[0] ?? line)
            : renderCompact(ctx, fitWidth, false);
        const activityLines = collectActivityLines(ctx, false, fitWidth);
        lines = [...headerLines];
        if (showSeparators && activityLines.length > 0) {
            const maxWidth = Math.max(...headerLines.map(visualLength), 20);
            const separatorWidth = terminalWidth ? Math.min(maxWidth, terminalWidth) : maxWidth;
            lines.push(makeSeparator(separatorWidth));
        }
        lines.push(...activityLines);
    }
    const physicalLines = lines.flatMap(line => line.split('\n'));
    // Only wrap when terminal width is real (known). When width is the
    // UNKNOWN_TERMINAL_WIDTH fallback, wrapping would use an arbitrary value
    // and produce incorrect line breaks.
    const wrapWidth = terminalWidth !== UNKNOWN_TERMINAL_WIDTH ? (terminalWidth ?? 0) : 0;
    const visibleLines = physicalLines.flatMap(line => wrapLineToWidth(line, wrapWidth));
    for (const line of visibleLines) {
        const outputLine = `${RESET}${line}`;
        write(outputLine);
    }
}
//# sourceMappingURL=index.js.map