import { type UsageSnapshot } from './usage-snapshot.js';
export type UsageWindows = Pick<UsageSnapshot, 'five_hour' | 'seven_day' | 'model_scoped' | 'extra_usage'>;
type FetchOutcome = {
    kind: 'ok';
    windows: UsageWindows;
} | {
    kind: 'auth_expired';
} | {
    kind: 'forbidden';
} | {
    kind: 'rate_limited';
    retryAfterMs: number | null;
} | {
    kind: 'error';
};
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
 * Keychain account names Claude Code may have filed the login under, most likely
 * first. Claude Code writes with `-a $USER`, but a Claude Code started without
 * USER leaves a second item under the SAME service (seen live: account "unknown",
 * holding only MCP tokens). A lookup without `-a` returns whichever item the
 * Keychain lists first, and for 33 hours that was the orphan: no
 * `claudeAiOauth`, so every poll failed as auth_expired while the real login sat
 * one item over.
 */
export declare function keychainAccountCandidates(env?: NodeJS.ProcessEnv, username?: string | null): string[];
/**
 * First token found for `service`: each candidate account in order, then an
 * account-less lookup (whatever item the Keychain lists first) as the last resort.
 */
export declare function readKeychainTokenForAccounts(service: string, accounts: string[], read: (service: string, account?: string) => string | null): string | null;
/**
 * Read the OAuth token for THIS profile: macOS Keychain (profile-specific
 * service) first, credentials file otherwise. A custom profile intentionally
 * has no bare-service fallback — serving the default account's token to a
 * work profile would be worse than serving nothing.
 */
export declare function readOauthToken(configDir: string, homeDir?: string): string | null;
export declare function parseUsageResponse(body: string): UsageWindows | null;
/** `Retry-After` header (delta-seconds or HTTP-date) → milliseconds, null if unusable. */
export declare function parseRetryAfterMs(headerValue: string | null, nowMs: number): number | null;
export declare function successSnapshot(windows: UsageWindows, now: number, prev?: UsageSnapshot | null): UsageSnapshot;
export type FailureKind = Exclude<UsageSnapshot['status'], 'ok'> | 'forbidden' | 'no_login';
export declare function backoffMs(kind: FailureKind, failures: number, retryAfterMs?: number | null, random?: () => number): number;
export declare function failureSnapshot(prev: UsageSnapshot | null, kind: FailureKind, now: number, retryAfterMs?: number | null, random?: () => number): UsageSnapshot;
export type FetchUsage = (token: string, userAgent: string, now: number) => Promise<FetchOutcome>;
export declare function classifyResponse(status: number, body: string, retryAfter: string | null, now: number): FetchOutcome;
export interface AccountRecord {
    version: 1;
    fetched_at: string | null;
    windows: UsageWindows | null;
    failure: FailureKind | null;
    next_attempt_at: string | null;
    failure_count: number;
}
export declare function accountsDir(homeDir?: string, env?: NodeJS.ProcessEnv): string;
export declare function readAccountKey(homeDir?: string): string | null;
export interface RefreshDeps {
    now: () => number;
    random: () => number;
    snapshotPath: string;
    readToken: () => string | null;
    fetchUsage: FetchUsage;
    userAgent: () => Promise<string>;
    accountKey: string | null;
    accountsDir: string;
    isAlive?: (pid: number) => boolean;
}
export type RefreshResult = 'fresh' | 'no-token' | 'shared' | 'backing-off' | 'busy' | FetchOutcome['kind'];
export declare function refreshUsage(deps: RefreshDeps): Promise<RefreshResult>;
export {};
//# sourceMappingURL=refresh-usage.d.ts.map