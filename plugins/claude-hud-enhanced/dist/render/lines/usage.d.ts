import type { RenderContext } from "../../types.js";
import { type ProgressLabelInput } from "./label-align.js";
/**
 * "⚠ stale (1d 9h ago)": says the usage numbers beside it are a last-known
 * reading the OAuth poll has failed to refresh, and how old that reading is.
 * Shared by the expanded usage line and the compact session line.
 */
export declare function formatStaleUsageMarker(staleSince: Date, colors?: RenderContext["config"]["colors"], now?: number): string;
export declare function renderUsageLine(ctx: RenderContext, labelOptions?: ProgressLabelInput): string | null;
//# sourceMappingURL=usage.d.ts.map