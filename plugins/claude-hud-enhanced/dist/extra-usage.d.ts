import type { UsageData } from './types.js';
export declare const DEFAULT_DECIMAL_PLACES = 2;
export interface ExtraSpend {
    spent: number;
    limit: number | null;
    percent: number | null;
    symbol: string;
    decimals: number;
}
export declare const minorToAmount: (minor: number, decimals?: number) => number;
export declare const currencySymbol: (currency: string | undefined) => string;
export declare const formatAmount: (amount: number, decimals?: number) => string;
export declare const formatLimit: (amount: number, decimals?: number) => string;
export declare function extraSpend(usage: UsageData | null | undefined): ExtraSpend | null;
export declare const spentText: (spend: ExtraSpend) => string;
export declare const spendRatio: (spend: ExtraSpend) => string;
export declare const extraSpendLabel: (spend: ExtraSpend) => string;
//# sourceMappingURL=extra-usage.d.ts.map