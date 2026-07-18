import type { UsageData } from './types.js';
/**
 * Local idle reset detection (no network).
 *
 * The HUD only receives fresh `rate_limits` on stdin when the user sends a
 * message — Claude Code refreshes them from the API response. Between messages
 * the numbers are frozen. The one thing that legitimately changes while idle is
 * a usage window *rolling over* at its reset time: the user's own usage on this
 * machine can't rise without a message, so once a window's `resets_at` has
 * passed, its true usage is ~0%.
 *
 * This reflects that locally: for any window whose reset time is now in the
 * past, zero the percentage and roll `resets_at` forward to the next occurrence.
 * Windows whose reset is still in the future are untouched (a message would have
 * refreshed them with a future reset). A `null` percentage stays `null`.
 *
 * Scope line: this only zeroes on rollover. It does not reflect usage burned by
 * *other* devices/sessions while this machine is idle, and the percentage
 * between resets remains the last stdin snapshot. Local-only by design.
 */
export declare function applyIdleUsageReset(usage: UsageData | null, now?: number): UsageData | null;
//# sourceMappingURL=idle-usage-reset.d.ts.map