import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getClaudeConfigJsonCandidates, getHudPluginDir } from './claude-config-dir.js';
import { sanitizeDisplayText, stripBom } from './utils/sanitize.js';
const EMPTY_AUTH_INFO = { method: null, user: null };
const API_KEY_AUTH_INFO = { method: 'API Key', user: null };
const AUTH_VALUE_MAX_LEN = 128;
function hasApiKey(env) {
    return typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0;
}
/**
 * True when a cloud provider (Amazon Bedrock or Google Vertex) is the active
 * auth. In that mode the request is signed with the cloud IAM identity, so any
 * `oauthAccount` still sitting in claude.json is a stale claude.ai login, not
 * the credential in effect — rendering its plan (e.g. "Team") beside the
 * provider label is misleading. Mirrors getProviderLabel()'s Bedrock/Vertex
 * detection (stdin.ts) and is read at render time, so the daemon's staged
 * per-request env resolves it to the REQUESTING session (see daemon.ts).
 */
function isCloudProviderAuthActive(env) {
    return env.CLAUDE_CODE_USE_BEDROCK === '1' || env.CLAUDE_CODE_USE_VERTEX === '1';
}
// Strip ANSI sequences and control/bidi characters so values from
// claude.json can never smuggle escape sequences into the terminal.
function sanitizeValue(value) {
    return sanitizeDisplayText(value).trim().slice(0, AUTH_VALUE_MAX_LEN);
}
function readString(obj, key) {
    const value = obj[key];
    if (typeof value !== 'string') {
        return null;
    }
    const sanitized = sanitizeValue(value);
    return sanitized.length > 0 ? sanitized : null;
}
/**
 * Formats an organizationType value into a display label:
 * "claude_max" → "Claude Max", "claude_pro" → "Claude Pro".
 */
function formatOrgType(orgType) {
    return orgType
        .split('_')
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' ');
}
/**
 * Extracts a multiplier suffix from a rate-limit tier value:
 * "default_claude_max_20x" → "20x". Returns null when no tier is encoded.
 */
function extractTierSuffix(rateLimitTier) {
    const match = /_(\d+x)$/i.exec(rateLimitTier);
    return match ? match[1] : null;
}
/**
 * Derives auth info from the parsed contents of {CLAUDE_CONFIG_DIR}.json.
 * Pure so it can be tested without touching the filesystem.
 */
export function deriveAuthInfo(claudeJson, env = process.env) {
    // ANTHROPIC_API_KEY takes precedence at runtime. oauthAccount can remain in
    // claude.json after a user switches to API-key authentication.
    if (hasApiKey(env)) {
        return API_KEY_AUTH_INFO;
    }
    const root = (claudeJson && typeof claudeJson === 'object')
        ? claudeJson
        : null;
    const account = (root?.oauthAccount && typeof root.oauthAccount === 'object')
        ? root.oauthAccount
        : null;
    if (!account) {
        return EMPTY_AUTH_INFO;
    }
    let method = null;
    const orgType = readString(account, 'organizationType');
    if (orgType) {
        method = formatOrgType(orgType);
        const rateLimitTier = readString(account, 'organizationRateLimitTier');
        const tier = rateLimitTier ? extractTierSuffix(rateLimitTier) : null;
        if (tier && !method.toLowerCase().includes(tier.toLowerCase())) {
            method += ` ${tier}`;
        }
    }
    const email = readString(account, 'emailAddress');
    const user = email ? email.split('@')[0] : readString(account, 'displayName');
    return { method, user };
}
function authCachePath(homeDir) {
    return path.join(getHudPluginDir(homeDir), AUTH_CACHE_DIRNAME, 'auth.json');
}
const AUTH_CACHE_DIRNAME = 'auth-cache';
// v2: keyed on a composite identity over ALL candidate config files rather than
// one file's stat fields. Older v1 entries fail the version check and re-parse.
const AUTH_CACHE_VERSION = 2;
const AUTH_CACHE_MAX_BYTES = 4096;
function normalizeCachedValue(value) {
    if (value === null)
        return null;
    if (typeof value !== 'string' || value.length === 0 || value.length > AUTH_VALUE_MAX_LEN) {
        return undefined;
    }
    return sanitizeValue(value) === value ? value : undefined;
}
function readAuthCache(homeDir) {
    let fd;
    try {
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
        fd = fs.openSync(authCachePath(homeDir), flags);
        const cacheStat = fs.fstatSync(fd);
        if (!cacheStat.isFile() || cacheStat.size <= 0 || cacheStat.size > AUTH_CACHE_MAX_BYTES) {
            return null;
        }
        const parsed = JSON.parse(fs.readFileSync(fd, 'utf-8'));
        const method = parsed && typeof parsed === 'object'
            ? normalizeCachedValue(parsed.method)
            : undefined;
        const user = parsed && typeof parsed === 'object'
            ? normalizeCachedValue(parsed.user)
            : undefined;
        const identity = parsed && typeof parsed === 'object'
            ? parsed.identity
            : undefined;
        if (parsed == null || typeof parsed !== 'object'
            || parsed.version !== AUTH_CACHE_VERSION
            || typeof identity !== 'string'
            || identity.length === 0
            || method === undefined
            || user === undefined) {
            return null;
        }
        return { version: AUTH_CACHE_VERSION, identity, method, user };
    }
    catch {
        return null;
    }
    finally {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            }
            catch { /* best effort */ }
        }
    }
}
function writeAuthCache(homeDir, entry) {
    let tmpPath;
    let fd;
    try {
        const cachePath = authCachePath(homeDir);
        const cacheDir = path.dirname(cachePath);
        fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
        const dirStat = fs.lstatSync(cacheDir);
        if (!dirStat.isDirectory() || dirStat.isSymbolicLink())
            return;
        try {
            fs.chmodSync(cacheDir, 0o700);
        }
        catch { /* best effort */ }
        // Write-then-rename: the status line can run concurrently across sessions,
        // and a torn read would just miss the cache, but a torn WRITE would persist.
        tmpPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
        fd = fs.openSync(tmpPath, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(entry), 'utf-8');
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmpPath, cachePath);
        tmpPath = undefined;
        try {
            fs.chmodSync(cachePath, 0o600);
        }
        catch { /* best effort */ }
    }
    catch {
        // A cache write must never break the status line.
    }
    finally {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            }
            catch { /* best effort */ }
        }
        if (tmpPath) {
            try {
                fs.unlinkSync(tmpPath);
            }
            catch { /* best effort */ }
        }
    }
}
/**
 * Builds the composite identity used as the auth cache key: every candidate
 * config path with its existence and stat fields, in priority order. A rewrite,
 * a same-size edit, or an account appearing in a file that previously had none
 * all change this string.
 */
function buildAuthSourceIdentity(sources) {
    return sources
        .map(({ path: sourcePath, stat }) => stat
        ? `${sourcePath}|${stat.mtimeMs}|${stat.ctimeMs}|${stat.size}|${stat.dev}|${stat.ino}`
        : `${sourcePath}|absent`)
        .join('\n');
}
/**
 * Derives auth from the candidate config files in priority order. The first
 * file that yields an actual account (a method or user) wins — this is what
 * lets a default profile skip an empty `~/.claude/.claude.json` stub and
 * resolve the real account from the sibling `~/.claude.json`. When no file
 * carries an account, the first parseable (empty) result is returned so the
 * outcome is a clean "nothing to show" rather than an error.
 */
function deriveAuthInfoFromSources(sources) {
    let fallback = null;
    for (const { path: sourcePath, stat } of sources) {
        if (!stat) {
            continue;
        }
        let info;
        try {
            // stripBom stays: a config.json saved by a Windows editor carries U+FEFF,
            // and JSON.parse rejects it. Upstream does not handle that.
            const content = stripBom(fs.readFileSync(sourcePath, 'utf-8'));
            info = deriveAuthInfo(JSON.parse(content));
        }
        catch {
            continue;
        }
        if (info.method || info.user) {
            return info;
        }
        if (fallback === null) {
            fallback = info;
        }
    }
    return fallback ?? EMPTY_AUTH_INFO;
}
/**
 * Reads auth info for the current login. Never throws.
 *
 * claude.json is the user's entire CLI config and grows with project history —
 * tens of KB is common. The status line runs on every interaction, so parsing
 * it per tick is not free. The derived fields are cached against the identity
 * of every candidate config file (path + existence + stat), so the steady-state
 * cost is a couple of stats plus a small read.
 */
export function readAuthInfo() {
    // Avoid reading a stale OAuth profile when the active source is an API key.
    if (hasApiKey(process.env)) {
        return API_KEY_AUTH_INFO;
    }
    const homeDir = os.homedir();
    const sources = getClaudeConfigJsonCandidates(homeDir).map((sourcePath) => {
        try {
            return { path: sourcePath, stat: fs.statSync(sourcePath) };
        }
        catch {
            return { path: sourcePath, stat: null };
        }
    });
    if (!sources.some((source) => source.stat)) {
        return EMPTY_AUTH_INFO;
    }
    const identity = buildAuthSourceIdentity(sources);
    const cached = readAuthCache(homeDir);
    if (cached && cached.identity === identity) {
        return { method: cached.method, user: cached.user };
    }
    const info = deriveAuthInfoFromSources(sources);
    writeAuthCache(homeDir, {
        version: AUTH_CACHE_VERSION,
        identity,
        method: info.method,
        user: info.user,
    });
    return info;
}
export function truncateUser(user, maxLength) {
    if (maxLength <= 0 || user.length <= maxLength) {
        return user;
    }
    return `${user.slice(0, maxLength)}…`;
}
/**
 * Builds the standalone auth segment for the end of the first HUD line,
 * honoring the showAuth / showAuthUser / authUserLength display settings.
 * Returns e.g. "Claude Max 20x · yukinosh…", or null when nothing to show.
 */
export function formatAuthSegment(info, display, env = process.env) {
    if (!info) {
        return null;
    }
    // Under Bedrock/Vertex the cloud IAM identity is the active credential, so a
    // leftover claude.ai `oauthAccount` would render a stale plan (e.g. "Team")
    // beside the provider label. Suppress the whole segment in that mode.
    if (isCloudProviderAuthActive(env)) {
        return null;
    }
    const parts = [];
    if (display?.showAuth && info.method) {
        parts.push(display?.authShortLabel ? info.method.replace(/^Claude\s+/i, '') : info.method);
    }
    if (display?.showAuthUser && info.user) {
        parts.push(truncateUser(info.user, display?.authUserLength ?? 8));
    }
    return parts.length > 0 ? parts.join(' · ') : null;
}
//# sourceMappingURL=auth.js.map