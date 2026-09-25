import type { RenderContext } from '../types.js';
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
export declare function renderSessionLine(ctx: RenderContext, options?: SessionLineOptions): string;
//# sourceMappingURL=session-line.d.ts.map