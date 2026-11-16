import type { HudColorOverrides, UsageValueMode } from '../config.js';
import { extraSpend, extraSpendLabel, spentText, type ExtraSpend } from '../extra-usage.js';
import type { UsageData } from '../types.js';
import { hasFigure } from '../usage-available.js';
import { critical, getQuotaColor, label, warning, RESET, type QuotaTone } from './colors.js';

export const STALE_AFTER = 150_000;
const LIMIT_AT = 100;

type Colors = Partial<HudColorOverrides> | undefined;

export interface FreshWindow {
  seenAt?: number | null;
  isRolled?: boolean;
}

export const agoLabel = (ms: number): string => {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

export const windowNote = (w: FreshWindow, now: number): string | null => {
  if (w.isRolled) return 'reset';
  if (w.seenAt === undefined) return null;
  if (w.seenAt === null) return 'unconfirmed';
  return now - w.seenAt > STALE_AFTER ? `${agoLabel(now - w.seenAt)} ago` : null;
};

export type UsageWindowKey = 'fiveHour' | 'sevenDay';

export function usageNote(usage: UsageData, key: UsageWindowKey, now: number = Date.now()): string | null {
  const seenAt = key === 'fiveHour' ? usage.fiveHourSeenAt : usage.sevenDaySeenAt;
  const isRolled = key === 'fiveHour' ? usage.fiveHourRolled : usage.sevenDayRolled;

  return windowNote(
    {
      ...(seenAt !== undefined && { seenAt: seenAt === null ? null : seenAt.getTime() }),
      ...(isRolled && { isRolled: true }),
    },
    now,
  );
}

export const hasAgeNote = (usage: UsageData, now: number = Date.now()): boolean =>
  (['fiveHour', 'sevenDay'] as const).some(
    (key) => hasFigure(usage[key]) && (usageNote(usage, key, now)?.endsWith(' ago') ?? false),
  );

export interface UsageFigureOptions {
  colors?: Colors;
  mode?: UsageValueMode;
  note?: string | null;
  showNote?: boolean;
  tone?: QuotaTone;
}

export function formatUsageFigure(percent: number | null, options: UsageFigureOptions = {}): string {
  const { colors, mode = 'percent', note = null, showNote = true, tone = 'usage' } = options;
  if (!hasFigure(percent)) return '';
  const shown = mode === 'remaining' ? Math.max(0, 100 - percent) : percent;
  if (note === null) {
    return `${getQuotaColor(percent, colors, tone)}${shown}%${RESET}`;
  }
  return label(showNote ? `~${shown}% · ${note}` : `~${shown}%`, colors);
}

export type ExtraDetail = 'full' | 'short';

export function activeExtraSpend(usage: UsageData | null | undefined): ExtraSpend | null {
  return usage && usage.balanceLabel == null ? extraSpend(usage) : null;
}

export function formatExtraSpend(spend: ExtraSpend, colors: Colors, detail: ExtraDetail = 'full'): string {
  const paint = spend.percent !== null && spend.percent >= LIMIT_AT ? critical : warning;
  if (detail === 'short') {
    return paint(`${spend.symbol}${spentText(spend)}`, colors);
  }
  return `${label('extra', colors)} ${paint(extraSpendLabel(spend), colors)}`;
}
