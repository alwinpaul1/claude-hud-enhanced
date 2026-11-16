import type { RenderContext } from '../types.js';
import { type Fits } from './visual.js';
export interface SessionLineOptions {
    fitsRow?: Fits;
    maxWidth?: number | null;
    isSingleRow?: boolean;
}
export declare function renderSessionLine(ctx: RenderContext, options?: SessionLineOptions): string;
//# sourceMappingURL=session-line.d.ts.map