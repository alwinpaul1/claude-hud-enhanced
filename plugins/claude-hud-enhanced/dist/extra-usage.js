export const DEFAULT_DECIMAL_PLACES = 2;
const LIMIT_AT = 100;
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CAD: 'CA$', AUD: 'A$' };
export const minorToAmount = (minor, decimals = DEFAULT_DECIMAL_PLACES) => minor / 10 ** decimals;
export const currencySymbol = (currency) => {
    if (currency === undefined)
        return '$';
    const code = currency.toUpperCase();
    return SYMBOLS[code] ?? `${code.replace(/[^A-Z]/g, '').slice(0, 3)} `;
};
export const formatAmount = (amount, decimals = DEFAULT_DECIMAL_PLACES) => Math.max(0, amount).toFixed(decimals);
export const formatLimit = (amount, decimals = DEFAULT_DECIMAL_PLACES) => Number.isInteger(amount) ? `${amount}` : formatAmount(amount, decimals);
export function extraSpend(usage) {
    const extra = usage?.extraUsage;
    if (!usage || !extra || !extra.enabled)
        return null;
    const used = extra.used !== null && extra.used > 0 ? extra.used : 0;
    const isAtLimit = (usage.fiveHour ?? 0) >= LIMIT_AT || (usage.sevenDay ?? 0) >= LIMIT_AT;
    if (used === 0 && !isAtLimit)
        return null;
    const decimals = extra.decimals ?? DEFAULT_DECIMAL_PLACES;
    const limit = extra.limit !== null && extra.limit > 0 ? extra.limit : null;
    const share = limit === null ? null : (extra.utilization ?? (used / limit) * 100);
    const percent = extra.reached && limit !== null ? Math.max(LIMIT_AT, share ?? 0) : share;
    return {
        spent: minorToAmount(used, decimals),
        limit: limit === null ? null : minorToAmount(limit, decimals),
        percent: percent === null ? null : Math.max(0, percent),
        symbol: currencySymbol(extra.currency),
        decimals,
    };
}
export const spentText = (spend) => formatAmount(spend.spent, spend.decimals);
export const spendRatio = (spend) => spend.limit === null
    ? spentText(spend)
    : `${spentText(spend)}/${spend.symbol}${formatLimit(spend.limit, spend.decimals)}`;
export const extraSpendLabel = (spend) => `${spend.symbol}${spendRatio(spend)}`;
//# sourceMappingURL=extra-usage.js.map