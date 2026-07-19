import { type UsageSnapshot } from './usage-snapshot.js';
type UsageWindows = Pick<UsageSnapshot, 'five_hour' | 'seven_day'>;
/** Extract `claudeAiOauth.accessToken` from a credentials JSON blob. */
export declare function parseAccessToken(rawJson: string): string | null;
/**
 * Claude Code stores the default profile's token under the bare service name
 * and each custom CLAUDE_CONFIG_DIR profile under a suffixed service:
 * `Claude Code-credentials-<sha256(configDir)[:8]>` (verified against a live
 * multi-profile Keychain). Selecting the profile's own service — and NEVER
 * falling back to the bare (default-account) entry for a custom profile — is
 * what keeps profiles from silently mixing accounts in the usage snapshot.
 */
export declare function keychainServiceForConfigDir(configDir: string, homeDir: string): string;
/**
 * Read the OAuth token for THIS profile: macOS Keychain (profile-specific
 * service) first, credentials file otherwise. A custom profile intentionally
 * has no bare-service fallback — serving the default account's token to a
 * work profile would be worse than serving nothing.
 */
export declare function readOauthToken(configDir: string, homeDir?: string): string | null;
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