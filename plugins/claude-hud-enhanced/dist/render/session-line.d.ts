import type { RenderContext } from '../types.js';
/**
 * Renders the full session line (model + context bar + project + git + counts + usage + duration).
 * Used for compact layout mode.
 */
export declare function renderSessionLine(ctx: RenderContext): string;
/**
 * Build just the usage+weekly parts. Used by renderSessionLine (inline) and
 * by renderCompact (as its own second row when display.usageOnNewLine is on).
 */
export declare function renderUsageSecondLine(ctx: RenderContext): string | null;
//# sourceMappingURL=session-line.d.ts.map