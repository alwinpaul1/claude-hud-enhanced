import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getClaudeConfigDir } from './claude-config-dir.js';
import { BACKOFF_AUTH_MS, BACKOFF_ERROR_MS, USAGE_TTL_MS } from './usage-hybrid.js';
import {
  type UsageSnapshot,
  getLockPath,
  getSnapshotPath,
  readSnapshot,
  writeSnapshotAtomic,
} from './usage-snapshot.js';
import { getClaudeCodeVersion } from './version.js';

/**
 * Detached OAuth usage refresher (see docs/oauth-usage-poll-handoff.md).
 *
 * Spawned by the HUD (which holds the single-flight lock) when the shared
 * usage snapshot goes stale while idle. Reads the Claude Code OAuth token
 * READ-ONLY (never writes refreshed tokens back — that races Claude Code's own
 * store), asks the token's issuer for the account-wide usage, and persists it
 * via the same atomic snapshot writer the HUD uses. Token-read + endpoint
 * shape ported from sirmalloc/ccstatusline (src/utils/usage-fetch.ts).
 */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const FETCH_TIMEOUT_MS = 5_000;
const WATCHDOG_MS = 15_000;

type UsageWindows = Pick<UsageSnapshot, 'five_hour' | 'seven_day'>;

type FetchOutcome =
  | { kind: 'ok'; windows: UsageWindows }
  | { kind: 'auth_expired' }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'error' };

/** Extract `claudeAiOauth.accessToken` from a credentials JSON blob. */
export function parseAccessToken(rawJson: string): string | null {
  try {
    const parsed = JSON.parse(rawJson) as { claudeAiOauth?: { accessToken?: unknown } };
    const token = parsed?.claudeAiOauth?.accessToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * Claude Code stores the default profile's token under the bare service name
 * and each custom CLAUDE_CONFIG_DIR profile under a suffixed service:
 * `Claude Code-credentials-<sha256(configDir)[:8]>` (verified against a live
 * multi-profile Keychain). Selecting the profile's own service — and NEVER
 * falling back to the bare (default-account) entry for a custom profile — is
 * what keeps profiles from silently mixing accounts in the usage snapshot.
 */
export function keychainServiceForConfigDir(configDir: string, homeDir: string): string {
  const defaultDir = path.join(homeDir, '.claude');
  if (path.resolve(configDir) === path.resolve(defaultDir)) {
    return KEYCHAIN_SERVICE;
  }
  const suffix = createHash('sha256').update(configDir).digest('hex').slice(0, 8);
  return `${KEYCHAIN_SERVICE}-${suffix}`;
}

function readKeychainToken(service: string): string | null {
  try {
    const secret = execFileSync(
      'security',
      ['find-generic-password', '-s', service, '-w'],
      { encoding: 'utf8', timeout: FETCH_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    ).trim();
    return secret ? parseAccessToken(secret) : null;
  } catch {
    return null;
  }
}

function readCredentialsFileToken(configDir: string): string | null {
  try {
    return parseAccessToken(fs.readFileSync(path.join(configDir, '.credentials.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Read the OAuth token for THIS profile: macOS Keychain (profile-specific
 * service) first, credentials file otherwise. A custom profile intentionally
 * has no bare-service fallback — serving the default account's token to a
 * work profile would be worse than serving nothing.
 */
export function readOauthToken(configDir: string, homeDir: string = os.homedir()): string | null {
  if (process.platform === 'darwin') {
    const service = keychainServiceForConfigDir(configDir, homeDir);
    return readKeychainToken(service) ?? readCredentialsFileToken(configDir);
  }
  return readCredentialsFileToken(configDir);
}

/**
 * One API bucket → snapshot window. A `null` bucket (Enterprise accounts have
 * no rate-limit windows) parses to 0% with no reset, matching ccstatusline.
 */
function parseWindow(v: unknown): UsageSnapshot['five_hour'] | undefined {
  if (v === null) return { used_percentage: 0, resets_at: null };
  if (typeof v !== 'object' || v === undefined) return undefined;
  const w = v as { utilization?: unknown; resets_at?: unknown };
  return {
    used_percentage: typeof w.utilization === 'number' ? w.utilization : null,
    resets_at: typeof w.resets_at === 'string' ? w.resets_at : null,
  };
}

/** Parse the usage API body; null when it carries no usable window at all. */
export function parseUsageResponse(body: string): UsageWindows | null {
  try {
    const parsed = JSON.parse(body) as { five_hour?: unknown; seven_day?: unknown };
    if (typeof parsed !== 'object' || parsed === null) return null;
    const five = parseWindow(parsed.five_hour);
    const seven = parseWindow(parsed.seven_day);
    if (five === undefined && seven === undefined) return null;
    return {
      five_hour: five ?? { used_percentage: null, resets_at: null },
      seven_day: seven ?? { used_percentage: null, resets_at: null },
    };
  } catch {
    return null;
  }
}

/** `Retry-After` header (delta-seconds or HTTP-date) → milliseconds, null if unusable. */
export function parseRetryAfterMs(headerValue: string | null, nowMs: number): number | null {
  const v = headerValue?.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) {
    const seconds = Number.parseInt(v, 10);
    return seconds > 0 ? seconds * 1000 : null;
  }
  const retryAtMs = Date.parse(v);
  if (!Number.isFinite(retryAtMs)) return null;
  const ms = retryAtMs - nowMs;
  return ms > 0 ? ms : null;
}

export function successSnapshot(windows: UsageWindows, now: number): UsageSnapshot {
  return {
    updated_at: new Date(now).toISOString(),
    source: 'oauth',
    ...windows,
    status: 'ok',
    next_attempt_at: null,
  };
}

/**
 * Failed attempt → snapshot that PRESERVES the last-good values and does NOT
 * bump `updated_at` (the idle-TTL clock), only sets the retry backoff.
 */
export function failureSnapshot(
  prev: UsageSnapshot | null,
  status: Exclude<UsageSnapshot['status'], 'ok'>,
  now: number,
  retryAfterMs: number | null = null,
): UsageSnapshot {
  const backoffMs =
    status === 'auth_expired' ? BACKOFF_AUTH_MS
    : status === 'rate_limited' ? (retryAfterMs ?? 2 * USAGE_TTL_MS)
    : BACKOFF_ERROR_MS;
  return {
    updated_at: prev?.updated_at ?? new Date(0).toISOString(),
    source: prev?.source ?? 'oauth',
    five_hour: prev?.five_hour ?? { used_percentage: null, resets_at: null },
    seven_day: prev?.seven_day ?? { used_percentage: null, resets_at: null },
    status,
    next_attempt_at: new Date(now + backoffMs).toISOString(),
  };
}

async function fetchUsage(token: string, userAgent: string, now: number): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'error' };
  }
  if (res.status === 401 || res.status === 403) return { kind: 'auth_expired' };
  if (res.status === 429) {
    return { kind: 'rate_limited', retryAfterMs: parseRetryAfterMs(res.headers.get('retry-after'), now) };
  }
  if (!res.ok) return { kind: 'error' };
  const body = await res.text().catch(() => '');
  const windows = parseUsageResponse(body);
  return windows ? { kind: 'ok', windows } : { kind: 'error' };
}

async function main(): Promise<void> {
  const homeDir = os.homedir();
  const snapshotPath = getSnapshotPath(homeDir);
  const prev = readSnapshot(snapshotPath);
  const now = Date.now();

  // Double-check freshness: another writer (a second terminal's refresher, or
  // an active session's stdin) may have refreshed between spawn and now.
  if (prev) {
    const age = now - (Date.parse(prev.updated_at) || 0);
    const inBackoff = prev.next_attempt_at != null && Date.parse(prev.next_attempt_at) > now;
    if (age <= USAGE_TTL_MS || inBackoff) return;
  }

  const token = readOauthToken(getClaudeConfigDir(homeDir));
  if (!token) {
    writeSnapshotAtomic(snapshotPath, failureSnapshot(prev, 'auth_expired', now), now);
    return;
  }

  const version = await getClaudeCodeVersion().catch(() => undefined);
  const outcome = await fetchUsage(token, `claude-code/${version ?? 'unknown'}`, now);
  const done = Date.now();
  const snapshot =
    outcome.kind === 'ok'
      ? successSnapshot(outcome.windows, done)
      : failureSnapshot(
          prev,
          outcome.kind,
          done,
          outcome.kind === 'rate_limited' ? outcome.retryAfterMs : null,
        );
  writeSnapshotAtomic(snapshotPath, snapshot, done);
}

function removeLock(lockPath: string): void {
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    /* best effort */
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lockPath = getLockPath(os.homedir());
  // Watchdog: if anything wedges (keychain prompt, hung socket), release the
  // lock and die rather than linger. unref'd so a clean run exits naturally.
  const watchdog = setTimeout(() => {
    removeLock(lockPath);
    process.exit(1);
  }, WATCHDOG_MS);
  watchdog.unref();
  void main()
    .catch(() => {
      /* silent — detached child has nowhere to report */
    })
    .finally(() => {
      clearTimeout(watchdog);
      removeLock(lockPath); // always release the parent-taken single-flight lock
    });
}
