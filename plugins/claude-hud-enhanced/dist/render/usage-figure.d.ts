import type { HudColorOverrides, UsageValueMode } from '../config.js';
import { type ExtraSpend } from '../extra-usage.js';
import type { UsageData } from '../types.js';
import { type QuotaTone } from './colors.js';
export declare const STALE_AFTER = 150000;
type Colors = Partial<HudColorOverrides> | undefined;
export interface FreshWindow {
    seenAt?: number | null;
    isRolled?: boolean;
}
export declare const agoLabel: (ms: number) => string;
export declare const windowNote: (w: FreshWindow, now: number) => string | null;
export type UsageWindowKey = 'fiveHour' | 'sevenDay';
export declare function usageNote(usage: UsageData, key: UsageWindowKey, now?: number): string | null;
export declare const hasAgeNote: (usage: UsageData, now?: number) => boolean;
export interface UsageFigureOptions {
    colors?: Colors;
    mode?: UsageValueMode;
    note?: string | null;
    showNote?: boolean;
    tone?: QuotaTone;
}
export declare function formatUsageFigure(percent: number | null, options?: UsageFigureOptions): string;
export type ExtraDetail = 'full' | 'short';
export declare function activeExtraSpend(usage: UsageData | null | undefined): ExtraSpend | null;
export declare function formatExtraSpend(spend: ExtraSpend, colors: Colors, detail?: ExtraDetail): string;
export {};
//# sourceMappingURL=usage-figure.d.ts.map