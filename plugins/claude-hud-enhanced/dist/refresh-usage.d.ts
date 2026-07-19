import { type UsageSnapshot } from './usage-snapshot.js';
type UsageWindows = Pick<UsageSnapshot, 'five_hour' | 'seven_day'>;
/** Extract `claudeAiOauth.accessToken` from a credentials JSON blob. */
export declare function parseAccessToken(rawJson: string): string | null;
/** Read the Claude Code OAuth token: macOS Keychain first, credentials file otherwise. */
export declare function readOauthToken(configDir: string): string | null;
/** Parse the usage API body; null when it carries no usable window at all. */
export declare function parseUsageResponse(body: string): UsageWindows | null;
/** `Retry-After` header (delta-seconds or HTTP-date) → milliseconds, null if unusable. */
export declare function parseRetryAfterMs(headerValue: string | null, nowMs: number): number | null;
export declare function successSnapshot(windows: UsageWindows, now: number): UsageSnapshot;
/**
 * Failed attempt → snapshot that PRESERVES the last-good values and does NOT
 * bump `updated_at` (the idle-TTL clock), only sets the retry backoff.
 */
export declare function failureSnapshot(prev: UsageSnapshot | null, status: Exclude<UsageSnapshot['status'], 'ok'>, now: number, retryAfterMs?: number | null): UsageSnapshot;
export {};
//# sourceMappingURL=refresh-usage.d.ts.map