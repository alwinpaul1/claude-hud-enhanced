import { RESET } from './colors.js';
import { codePointCellWidth, isCjkAmbiguousWide } from './width.js';
// eslint-disable-next-line no-control-regex
export const ANSI_ESCAPE_PATTERN = /^(?:\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/;
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_GLOBAL = /(?:\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/g;
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
export function stripAnsi(str) {
    return str.replace(ANSI_ESCAPE_GLOBAL, '');
}
function splitAnsiTokens(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
        const ansiMatch = ANSI_ESCAPE_PATTERN.exec(str.slice(i));
        if (ansiMatch) {
            tokens.push({ type: 'ansi', value: ansiMatch[0] });
            i += ansiMatch[0].length;
            continue;
        }
        let j = i;
        while (j < str.length) {
            const nextAnsi = ANSI_ESCAPE_PATTERN.exec(str.slice(j));
            if (nextAnsi) {
                break;
            }
            j += 1;
        }
        tokens.push({ type: 'text', value: str.slice(i, j) });
        i = j;
    }
    return tokens;
}
export function segmentGraphemes(text) {
    if (!text) {
        return [];
    }
    if (!GRAPHEME_SEGMENTER) {
        return Array.from(text);
    }
    return Array.from(GRAPHEME_SEGMENTER.segment(text), segment => segment.segment);
}
export function graphemeWidth(grapheme, ambiguousWide) {
    if (!grapheme || /^\p{Control}$/u.test(grapheme)) {
        return 0;
    }
    // Emoji glyphs and ZWJ sequences generally render as double-width.
    if (/\p{Extended_Pictographic}/u.test(grapheme)) {
        return 2;
    }
    let hasVisibleBase = false;
    let width = 0;
    for (const char of Array.from(grapheme)) {
        if (/^\p{Mark}$/u.test(char) || char === '\u200D' || char === '\uFE0E' || char === '\uFE0F') {
            continue;
        }
        hasVisibleBase = true;
        const codePoint = char.codePointAt(0);
        if (codePoint !== undefined) {
            width = Math.max(width, codePointCellWidth(codePoint, ambiguousWide));
        }
        else {
            width = Math.max(width, 1);
        }
    }
    return hasVisibleBase ? width : 0;
}
export function visualLength(str) {
    const ambiguousWide = isCjkAmbiguousWide();
    let width = 0;
    for (const token of splitAnsiTokens(str)) {
        if (token.type === 'ansi') {
            continue;
        }
        for (const grapheme of segmentGraphemes(token.value)) {
            width += graphemeWidth(grapheme, ambiguousWide);
        }
    }
    return width;
}
export function sliceVisible(str, maxVisible) {
    if (maxVisible <= 0) {
        return '';
    }
    const ambiguousWide = isCjkAmbiguousWide();
    let result = '';
    let visibleWidth = 0;
    let done = false;
    let i = 0;
    while (i < str.length && !done) {
        const ansiMatch = ANSI_ESCAPE_PATTERN.exec(str.slice(i));
        if (ansiMatch) {
            result += ansiMatch[0];
            i += ansiMatch[0].length;
            continue;
        }
        let j = i;
        while (j < str.length) {
            const nextAnsi = ANSI_ESCAPE_PATTERN.exec(str.slice(j));
            if (nextAnsi) {
                break;
            }
            j += 1;
        }
        const plainChunk = str.slice(i, j);
        for (const grapheme of segmentGraphemes(plainChunk)) {
            const graphemeCellWidth = graphemeWidth(grapheme, ambiguousWide);
            if (visibleWidth + graphemeCellWidth > maxVisible) {
                done = true;
                break;
            }
            result += grapheme;
            visibleWidth += graphemeCellWidth;
        }
        i = j;
    }
    return result;
}
// OSC 8 close sequence (`\x1b]8;;\x1b\\`) terminates the current hyperlink.
// If truncation cuts inside an open OSC 8 hyperlink, emitting only an SGR
// reset (`\x1b[0m`) is not enough — the terminal keeps treating subsequent
// output as part of the link and renders its underline across the rest of
// the line. This helper returns the close sequence iff the last OSC 8 in
// `str` opened a hyperlink (non-empty URL) without being followed by a
// closer (empty URL).
const OSC8_OPEN_OR_CLOSE = /\x1b\]8;;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const OSC8_CLOSE = '\x1b]8;;\x1b\\';
export function closeOpenHyperlink(str) {
    let last = null;
    let match;
    OSC8_OPEN_OR_CLOSE.lastIndex = 0;
    while ((match = OSC8_OPEN_OR_CLOSE.exec(str)) !== null) {
        last = match;
    }
    return last && last[1].length > 0 ? OSC8_CLOSE : '';
}
export function truncateToWidth(str, maxWidth) {
    if (maxWidth <= 0 || visualLength(str) <= maxWidth) {
        return str;
    }
    const suffix = maxWidth >= 3 ? '...' : '.'.repeat(maxWidth);
    const keep = Math.max(0, maxWidth - suffix.length);
    // A cut that lands right after a segment separator leaves a dangling "|"
    // at the edge of the pane; drop trailing separators and spaces first.
    const sliced = sliceVisible(str, keep).replace(/(?:\s|\||│)+(?:\x1b\[[0-9;]*m)*$/u, '');
    // Close the hyperlink (if any) before the ellipsis so the suffix renders
    // as plain text rather than as part of the truncated link.
    return `${sliced}${closeOpenHyperlink(sliced)}${suffix}${RESET}`;
}
export function clipToWidth(str, maxWidth) {
    if (maxWidth <= 0 || visualLength(str) <= maxWidth) {
        return str;
    }
    const sliced = sliceVisible(str, maxWidth - 1).replace(/(?:\s|\||│|·)+(?:\x1b\[[0-9;]*m)*$/u, '');
    return `${sliced}${closeOpenHyperlink(sliced)}${RESET}…`;
}
export function clipPlain(text, maxCells) {
    if (maxCells <= 0)
        return '';
    if (visualLength(text) <= maxCells)
        return text;
    return `${sliceVisible(text, maxCells - 1)}…`;
}
export const fitsWidth = (maxWidth) => typeof maxWidth === 'number' && maxWidth > 0 ? (line) => visualLength(line) <= maxWidth : undefined;
export function firstFitting(candidates, fits) {
    let last = '';
    for (const candidate of candidates) {
        last = candidate();
        if (!fits || fits(last))
            return last;
    }
    return last;
}
//# sourceMappingURL=visual.js.map