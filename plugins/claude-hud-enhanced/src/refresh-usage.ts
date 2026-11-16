import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getClaudeConfigDir, getClaudeConfigJsonCandidates } from './claude-config-dir.js';
import {
  BACKOFF_AUTH_MAX_MS,
  BACKOFF_AUTH_MS,
  BACKOFF_ERROR_MAX_MS,
  BACKOFF_ERROR_MS,
  BACKOFF_FORBIDDEN_MAX_MS,
  BACKOFF_FORBIDDEN_MS,
  BACKOFF_JITTER,
  BACKOFF_NO_LOGIN_MS,
  BACKOFF_RATE_LIMIT_MAX_MS,
  BACKOFF_RATE_LIMIT_MS,
  USAGE_TTL_MS,
  defaultSnapshotFs,
  shouldRefresh,
  tryTakeLock,
} from './usage-hybrid.js';
import {
  type ExtraUsage,
  type UsageSnapshot,
  type UsageSnapshotWindow,
  getLockPath,
  getSnapshotPath,
  readSnapshot,
  writeSnapshotAtomic,
} from './usage-snapshot.js';
import { ensurePrivateDir, readJsonCache, writeJsonCacheAtomic } from './utils/cache-file.js';
import { hasFigure } from './usage-available.js';
import { stripBom } from './utils/sanitize.js';
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
const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_MS = 7 * 24 * 60 * 60 * 1000;
const WATCHDOG_MS = 15_000;

export type UsageWindows = Pick<UsageSnapshot, 'five_hour' | 'seven_day' | 'model_scoped' | 'extra_usage'>;

type FetchOutcome =
  | { kind: 'ok'; windows: UsageWindows }
  | { kind: 'auth_expired' }
  | { kind: 'forbidden' }
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

function readKeychainToken(service: string, account?: string): string | null {
  try {
    const secret = execFileSync(
      'security',
      ['find-generic-password', '-s', service, ...(account ? ['-a', account] : []), '-w'],
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
 * Keychain account names Claude Code may have filed the login under, most likely
 * first. Claude Code writes with `-a $USER`, but a Claude Code started without
 * USER leaves a second item under the SAME service (seen live: account "unknown",
 * holding only MCP tokens). A lookup without `-a` returns whichever item the
 * Keychain lists first, and for 33 hours that was the orphan: no
 * `claudeAiOauth`, so every poll failed as auth_expired while the real login sat
 * one item over.
 */
export function keychainAccountCandidates(
  env: NodeJS.ProcessEnv = process.env,
  username: string | null = currentUsername(),
): string[] {
  const names = [env.USER, username].filter(
    (name): name is string => typeof name === 'string' && name.trim() !== '',
  );
  return [...new Set(names)];
}

function currentUsername(): string | null {
  try {
    return os.userInfo().username;
  } catch {
    return null;
  }
}

/**
 * First token found for `service`: each candidate account in order, then an
 * account-less lookup (whatever item the Keychain lists first) as the last resort.
 */
export function readKeychainTokenForAccounts(
  service: string,
  accounts: string[],
  read: (service: string, account?: string) => string | null,
): string | null {
  for (const account of accounts) {
    const token = read(service, account);
    if (token) return token;
  }
  return read(service);
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
    return readKeychainTokenForAccounts(service, keychainAccountCandidates(), readKeychainToken)
      ?? readCredentialsFileToken(configDir);
  }
  return readCredentialsFileToken(configDir);
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const resetIso = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

const ABSENT: UsageSnapshotWindow = { used_percentage: null, resets_at: null };

function parseWindow(v: unknown): UsageSnapshotWindow {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ...ABSENT };
  const w = v as { utilization?: unknown; percent?: unknown; resets_at?: unknown };
  return { used_percentage: finite(w.utilization) ?? finite(w.percent), resets_at: resetIso(w.resets_at) };
}

function limitOfKind(limits: unknown, kinds: string[]): UsageSnapshotWindow {
  if (!Array.isArray(limits)) return { ...ABSENT };
  for (const raw of limits) {
    const limit = raw as { kind?: unknown; scope?: unknown } | null;
    if (limit && typeof limit.kind === 'string' && kinds.includes(limit.kind) && limit.scope == null) return parseWindow(limit);
  }
  return { ...ABSENT };
}

const isAbsent = (w: UsageSnapshotWindow): boolean => w.used_percentage === null && w.resets_at === null;

/**
 * Model-scoped weekly windows from the `limits` array. The API has no top-level
 * bucket for them: Fable arrives as
 * `{ kind: "weekly_scoped", percent, resets_at, scope: { model: { display_name } } }`.
 * Entries scoped to anything other than a named model are skipped. Undefined when
 * the body has no `limits` array at all, so older API shapes add no key.
 */
function parseScopedLimits(limits: unknown): UsageSnapshot['model_scoped'] {
  if (!Array.isArray(limits)) return undefined;
  const windows: NonNullable<UsageSnapshot['model_scoped']> = [];
  const active: NonNullable<UsageSnapshot['model_scoped']> = [];
  let isFlagged = false;
  for (const raw of limits) {
    const limit = raw as {
      kind?: unknown;
      percent?: unknown;
      resets_at?: unknown;
      is_active?: unknown;
      scope?: { model?: { display_name?: unknown } | null } | null;
    } | null;
    const name = limit?.scope?.model?.display_name;
    if (limit?.kind !== 'weekly_scoped' || typeof name !== 'string' || name.trim() === '') continue;
    const window = {
      display_name: name,
      utilization: typeof limit.percent === 'number' ? limit.percent : null,
      resets_at: typeof limit.resets_at === 'string' ? limit.resets_at : null,
    };
    windows.push(window);
    if (limit.is_active === true) active.push(window);
    if (limit.is_active !== undefined) isFlagged = true;
  }
  if (!isFlagged) return windows;
  if (active.length > 0) return active;
  const fullest = [...windows].sort((a, b) => (b.utilization ?? -1) - (a.utilization ?? -1))[0];
  return fullest ? [fullest] : [];
}

const NAMED_WEEKLIES: [string, string][] = [
  ['seven_day_opus', 'Opus'],
  ['seven_day_sonnet', 'Sonnet'],
];

function parseNamedWeeklies(body: Record<string, unknown>): NonNullable<UsageSnapshot['model_scoped']> {
  const windows: NonNullable<UsageSnapshot['model_scoped']> = [];
  for (const [key, label] of NAMED_WEEKLIES) {
    const window = parseWindow(body[key]);
    if (window.used_percentage === null) continue;
    windows.push({ display_name: label, utilization: window.used_percentage, resets_at: window.resets_at });
  }
  return windows;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

function minorAmount(v: unknown): { amount: number | null; currency?: string; exponent: number | null } {
  if (typeof v !== 'object' || v === null) return { amount: finite(v), exponent: null };
  const money = v as { amount_minor?: unknown; currency?: unknown; exponent?: unknown };
  return { amount: finite(money.amount_minor), currency: text(money.currency), exponent: finite(money.exponent) };
}

function parseExtraUsage(v: unknown): ExtraUsage | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const extra = v as Record<string, unknown>;
  const spend = (typeof extra.spend === 'object' && extra.spend !== null ? extra.spend : {}) as Record<string, unknown>;
  const used = minorAmount(spend.used);
  const limit = minorAmount(spend.limit ?? extra.cap);
  const decimals = finite(extra.decimal_places) ?? used.exponent ?? limit.exponent;
  const currency = text(extra.currency) ?? used.currency ?? limit.currency;
  return {
    enabled: extra.is_enabled === true || extra.enabled === true,
    utilization: finite(extra.utilization) ?? finite(extra.percent),
    used: finite(extra.used_credits) ?? used.amount,
    limit: finite(extra.monthly_limit) ?? limit.amount,
    ...(currency !== undefined && { currency }),
    ...(decimals !== null && decimals >= 0 && decimals <= 6 && { decimals: Math.floor(decimals) }),
    ...(extra.spend_limit_reached === true && { reached: true }),
  };
}

export function parseUsageResponse(body: string): UsageWindows | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown> | null;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const topFive = parseWindow(parsed.five_hour);
    const topSeven = parseWindow(parsed.seven_day);
    const five = isAbsent(topFive) ? limitOfKind(parsed.limits, ['session', 'five_hour']) : topFive;
    const seven = isAbsent(topSeven) ? limitOfKind(parsed.limits, ['weekly_all', 'weekly', 'seven_day']) : topSeven;
    if ('error' in parsed && isAbsent(five) && isAbsent(seven)) return null;
    const limits = parseScopedLimits(parsed.limits);
    const named = limits === undefined || limits.length === 0 ? parseNamedWeeklies(parsed) : [];
    const scoped = limits === undefined && named.length === 0 ? undefined : [...(limits ?? []), ...named];
    const extra = parseExtraUsage(parsed.extra_usage);
    return {
      five_hour: five,
      seven_day: seven,
      ...(scoped !== undefined && { model_scoped: scoped }),
      ...(extra !== undefined && { extra_usage: extra }),
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

function liveWindow(
  next: UsageSnapshotWindow,
  prev: UsageSnapshotWindow | undefined,
  at: string,
  span: number,
): UsageSnapshotWindow {
  if (
    isAbsent(next)
    && prev !== undefined
    && hasFigure(prev.used_percentage)
    && prev.resets_at !== null
    && Date.parse(at) < Date.parse(prev.resets_at) + span
  ) {
    return prev;
  }
  const sameWindow =
    prev !== undefined
    && prev.resets_at !== null
    && next.resets_at !== null
    && Math.abs(Date.parse(prev.resets_at) - Date.parse(next.resets_at)) < 60_000;
  if (sameWindow && prev.used_percentage !== null && prev.used_percentage >= 100 && next.used_percentage === 0) {
    return prev;
  }
  return { ...next, seen_at: at };
}

export function successSnapshot(windows: UsageWindows, now: number, prev: UsageSnapshot | null = null): UsageSnapshot {
  const at = new Date(now).toISOString();
  return {
    updated_at: at,
    oauth_updated_at: at,
    source: 'oauth',
    five_hour: liveWindow(windows.five_hour, prev?.five_hour, at, FIVE_HOUR_MS),
    seven_day: liveWindow(windows.seven_day, prev?.seven_day, at, SEVEN_DAY_MS),
    ...(windows.model_scoped !== undefined && { model_scoped: windows.model_scoped }),
    ...(windows.extra_usage !== undefined && { extra_usage: windows.extra_usage }),
    status: 'ok',
    next_attempt_at: null,
    failure_count: 0,
  };
}

export type FailureKind = Exclude<UsageSnapshot['status'], 'ok'> | 'forbidden' | 'no_login';

const BACKOFF: Record<FailureKind, { base: number; max: number }> = {
  auth_expired: { base: BACKOFF_AUTH_MS, max: BACKOFF_AUTH_MAX_MS },
  error: { base: BACKOFF_ERROR_MS, max: BACKOFF_ERROR_MAX_MS },
  rate_limited: { base: BACKOFF_RATE_LIMIT_MS, max: BACKOFF_RATE_LIMIT_MAX_MS },
  forbidden: { base: BACKOFF_FORBIDDEN_MS, max: BACKOFF_FORBIDDEN_MAX_MS },
  no_login: { base: BACKOFF_NO_LOGIN_MS, max: BACKOFF_AUTH_MAX_MS },
};

export function backoffMs(
  kind: FailureKind,
  failures: number,
  retryAfterMs: number | null = null,
  random: () => number = () => 0,
): number {
  if (kind === 'rate_limited' && retryAfterMs !== null) return retryAfterMs;
  const { base, max } = BACKOFF[kind];
  const grown = Math.min(max, base * 2 ** Math.max(0, Math.min(failures, 16) - 1));
  return Math.round(grown * (1 + BACKOFF_JITTER * Math.max(0, Math.min(1, random()))));
}

export function failureSnapshot(
  prev: UsageSnapshot | null,
  kind: FailureKind,
  now: number,
  retryAfterMs: number | null = null,
  random: () => number = () => 0,
): UsageSnapshot {
  const failures = (prev?.failure_count ?? 0) + 1;
  return {
    updated_at: prev?.updated_at ?? new Date(0).toISOString(),
    oauth_updated_at: prev?.oauth_updated_at ?? null,
    source: prev?.source ?? 'oauth',
    five_hour: prev?.five_hour ?? { ...ABSENT },
    seven_day: prev?.seven_day ?? { ...ABSENT },
    ...(prev?.model_scoped !== undefined && { model_scoped: prev.model_scoped }),
    ...(prev?.extra_usage !== undefined && { extra_usage: prev.extra_usage }),
    status: kind === 'forbidden' ? (prev?.status ?? 'ok') : kind === 'no_login' ? 'auth_expired' : kind,
    next_attempt_at: new Date(now + backoffMs(kind, failures, retryAfterMs, random)).toISOString(),
    failure_count: failures,
  };
}

export type FetchUsage = (token: string, userAgent: string, now: number) => Promise<FetchOutcome>;

export function classifyResponse(status: number, body: string, retryAfter: string | null, now: number): FetchOutcome {
  if (status === 401) return { kind: 'auth_expired' };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rate_limited', retryAfterMs: parseRetryAfterMs(retryAfter, now) };
  if (status < 200 || status >= 300) return { kind: 'error' };
  const windows = parseUsageResponse(body);
  return windows ? { kind: 'ok', windows } : { kind: 'error' };
}

const fetchUsage: FetchUsage = async (token, userAgent, now) => {
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = res.ok ? await res.text().catch(() => '') : '';
    return classifyResponse(res.status, body, res.headers.get('retry-after'), now);
  } catch {
    return { kind: 'error' };
  }
};

export interface AccountRecord {
  version: 1;
  fetched_at: string | null;
  windows: UsageWindows | null;
  failure: FailureKind | null;
  next_attempt_at: string | null;
  failure_count: number;
}

const isAccountRecord = (v: unknown): v is AccountRecord => {
  const r = v as Partial<AccountRecord> | null;
  return (
    r != null
    && typeof r === 'object'
    && r.version === 1
    && (r.fetched_at === null || typeof r.fetched_at === 'string')
    && (r.next_attempt_at === null || typeof r.next_attempt_at === 'string')
    && typeof r.failure_count === 'number'
    && (r.windows === null || (typeof r.windows === 'object' && typeof r.windows.five_hour === 'object' && typeof r.windows.seven_day === 'object'))
  );
};

export function accountsDir(homeDir: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
  const base =
    process.platform === 'win32'
      ? env.LOCALAPPDATA?.trim() || path.join(homeDir, 'AppData', 'Local')
      : env.XDG_CACHE_HOME?.trim() || path.join(homeDir, '.cache');
  return path.join(base, 'claude-hud-enhanced', 'accounts');
}

export function readAccountKey(homeDir: string = os.homedir()): string | null {
  for (const candidate of getClaudeConfigJsonCandidates(homeDir)) {
    try {
      const account = (JSON.parse(stripBom(fs.readFileSync(candidate, 'utf8'))) as { oauthAccount?: Record<string, unknown> })
        .oauthAccount;
      const uuid = account?.accountUuid;
      if (typeof uuid !== 'string' || uuid.trim() === '') continue;
      const org = typeof account?.organizationUuid === 'string' ? account.organizationUuid : '';
      return createHash('sha256').update(`${uuid}\n${org}`).digest('hex').slice(0, 24);
    } catch {
      continue;
    }
  }
  return null;
}

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

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export async function refreshUsage(deps: RefreshDeps): Promise<RefreshResult> {
  const prev = readSnapshot(deps.snapshotPath);
  const now = deps.now();
  if (prev && !shouldRefresh(prev, now)) return 'fresh';

  const token = deps.readToken();
  if (!token) {
    writeSnapshotAtomic(deps.snapshotPath, failureSnapshot(prev, 'no_login', now, null, deps.random), now);
    return 'no-token';
  }

  const recordPath = deps.accountKey ? path.join(deps.accountsDir, `${deps.accountKey}.json`) : null;
  const lockPath = deps.accountKey ? path.join(deps.accountsDir, `.${deps.accountKey}.lock`) : null;
  const record = recordPath ? readJsonCache(recordPath, isAccountRecord) : null;
  const sharedAt = ms(record?.fetched_at);
  const prevLiveAt = ms(prev?.oauth_updated_at);
  if (record?.windows && sharedAt !== null && now - sharedAt <= USAGE_TTL_MS && sharedAt <= now && (prevLiveAt === null || sharedAt > prevLiveAt)) {
    writeSnapshotAtomic(deps.snapshotPath, successSnapshot(record.windows, sharedAt, prev), now);
    return 'shared';
  }
  const sharedRetryAt = ms(record?.next_attempt_at);
  if (record?.failure && sharedRetryAt !== null && sharedRetryAt > now) {
    writeSnapshotAtomic(
      deps.snapshotPath,
      { ...failureSnapshot(prev, record.failure, now), next_attempt_at: new Date(sharedRetryAt).toISOString(), failure_count: record.failure_count },
      now,
    );
    return 'backing-off';
  }
  if (lockPath) {
    try {
      ensurePrivateDir(deps.accountsDir);
    } catch {
      return 'busy';
    }
    if (!tryTakeLock(lockPath, now, defaultSnapshotFs, { reclaimDead: true, isAlive: deps.isAlive })) return 'busy';
  }

  try {
    const outcome = await deps.fetchUsage(token, await deps.userAgent(), now);
    const done = deps.now();
    const onDisk = readSnapshot(deps.snapshotPath) ?? prev;
    if (outcome.kind === 'ok') {
      writeSnapshotAtomic(deps.snapshotPath, successSnapshot(outcome.windows, done, onDisk), done);
      if (recordPath) {
        writeJsonCacheAtomic(recordPath, {
          version: 1,
          fetched_at: new Date(done).toISOString(),
          windows: outcome.windows,
          failure: null,
          next_attempt_at: null,
          failure_count: 0,
        } satisfies AccountRecord);
      }
      return 'ok';
    }
    const failed = failureSnapshot(
      onDisk ? { ...onDisk, failure_count: Math.max(onDisk.failure_count ?? 0, record?.failure_count ?? 0) } : null,
      outcome.kind,
      done,
      outcome.kind === 'rate_limited' ? outcome.retryAfterMs : null,
      deps.random,
    );
    writeSnapshotAtomic(deps.snapshotPath, failed, done);
    if (recordPath) {
      writeJsonCacheAtomic(recordPath, {
        version: 1,
        fetched_at: record?.fetched_at ?? null,
        windows: record?.windows ?? null,
        failure: outcome.kind,
        next_attempt_at: failed.next_attempt_at,
        failure_count: failed.failure_count ?? 1,
      } satisfies AccountRecord);
    }
    return outcome.kind;
  } finally {
    if (lockPath) removeLock(lockPath);
  }
}

async function main(): Promise<void> {
  const homeDir = os.homedir();
  await refreshUsage({
    now: Date.now,
    random: Math.random,
    snapshotPath: getSnapshotPath(homeDir),
    readToken: () => readOauthToken(getClaudeConfigDir(homeDir)),
    fetchUsage,
    userAgent: async () => `claude-code/${(await getClaudeCodeVersion().catch(() => undefined)) ?? 'unknown'}`,
    accountKey: readAccountKey(homeDir),
    accountsDir: accountsDir(homeDir),
  });
}

function removeLock(lockPath: string): void {
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lockPath = getLockPath(os.homedir());
  const watchdog = setTimeout(() => {
    removeLock(lockPath);
    process.exit(1);
  }, WATCHDOG_MS);
  watchdog.unref();
  void main()
    .catch(() => undefined)
    .finally(() => {
      clearTimeout(watchdog);
      removeLock(lockPath);
    });
}
