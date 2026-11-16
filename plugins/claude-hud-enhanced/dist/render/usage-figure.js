import { extraSpend, extraSpendLabel, spentText } from '../extra-usage.js';
import { hasFigure } from '../usage-available.js';
import { critical, getQuotaColor, label, warning, RESET } from './colors.js';
export const STALE_AFTER = 150_000;
const LIMIT_AT = 100;
export const agoLabel = (ms) => {
    const minutes = Math.max(1, Math.floor(ms / 60_000));
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};
export const windowNote = (w, now) => {
    if (w.isRolled)
        return 'reset';
    if (w.seenAt === undefined)
        return null;
    if (w.seenAt === null)
        return 'unconfirmed';
    return now - w.seenAt > STALE_AFTER ? `${agoLabel(now - w.seenAt)} ago` : null;
};
export function usageNote(usage, key, now = Date.now()) {
    const seenAt = key === 'fiveHour' ? usage.fiveHourSeenAt : usage.sevenDaySeenAt;
    const isRolled = key === 'fiveHour' ? usage.fiveHourRolled : usage.sevenDayRolled;
    return windowNote({
        ...(seenAt !== undefined && { seenAt: seenAt === null ? null : seenAt.getTime() }),
        ...(isRolled && { isRolled: true }),
    }, now);
}
export const hasAgeNote = (usage, now = Date.now()) => ['fiveHour', 'sevenDay'].some((key) => hasFigure(usage[key]) && (usageNote(usage, key, now)?.endsWith(' ago') ?? false));
export function formatUsageFigure(percent, options = {}) {
    const { colors, mode = 'percent', note = null, showNote = true, tone = 'usage' } = options;
    if (!hasFigure(percent))
        return '';
    const shown = mode === 'remaining' ? Math.max(0, 100 - percent) : percent;
    if (note === null) {
        return `${getQuotaColor(percent, colors, tone)}${shown}%${RESET}`;
    }
    return label(showNote ? `~${shown}% · ${note}` : `~${shown}%`, colors);
}
export function activeExtraSpend(usage) {
    return usage && usage.balanceLabel == null ? extraSpend(usage) : null;
}
export function formatExtraSpend(spend, colors, detail = 'full') {
    const paint = spend.percent !== null && spend.percent >= LIMIT_AT ? critical : warning;
    if (detail === 'short') {
        return paint(`${spend.symbol}${spentText(spend)}`, colors);
    }
    return `${label('extra', colors)} ${paint(extraSpendLabel(spend), colors)}`;
}
//# sourceMappingURL=usage-figure.js.map