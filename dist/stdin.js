import { AUTOCOMPACT_BUFFER_PERCENT } from './constants.js';
export async function readStdin() {
    if (process.stdin.isTTY) {
        return null;
    }
    const chunks = [];
    try {
        process.stdin.setEncoding('utf8');
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        const raw = chunks.join('');
        if (!raw.trim()) {
            return null;
        }
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function getTotalTokens(stdin) {
    const usage = stdin.context_window?.current_usage;
    return ((usage?.input_tokens ?? 0) +
        (usage?.cache_creation_input_tokens ?? 0) +
        (usage?.cache_read_input_tokens ?? 0));
}
export function getContextPercent(stdin) {
    // Use used_percentage directly from API if available (matches /context command)
    const usedPct = stdin.context_window?.used_percentage;
    if (usedPct !== undefined && usedPct !== null) {
        return Math.min(100, Math.floor(usedPct));
    }
    // Fallback to calculating from tokens
    const size = stdin.context_window?.context_window_size;
    if (!size || size <= 0) {
        return 0;
    }
    const totalTokens = getTotalTokens(stdin);
    return Math.min(100, Math.floor((totalTokens / size) * 100));
}
// Get used tokens - calculated from percentage when available to match /context
export function getUsedTokens(stdin) {
    const size = stdin.context_window?.context_window_size ?? 200000;
    const usedPct = stdin.context_window?.used_percentage;
    // If percentage is available, calculate tokens from it (matches /context)
    if (usedPct !== undefined && usedPct !== null) {
        return Math.floor(size * usedPct / 100);
    }
    // Fallback to direct token count
    return getTotalTokens(stdin);
}
export function getBufferedPercent(stdin) {
    const size = stdin.context_window?.context_window_size;
    if (!size || size <= 0) {
        return 0;
    }
    const totalTokens = getTotalTokens(stdin);
    const buffer = size * AUTOCOMPACT_BUFFER_PERCENT;
    return Math.min(100, Math.round(((totalTokens + buffer) / size) * 100));
}
export function getModelName(stdin) {
    return stdin.model?.display_name ?? stdin.model?.id ?? 'Unknown';
}
//# sourceMappingURL=stdin.js.map