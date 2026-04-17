import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { getClaudeConfigDir } from './claude-config-dir.js';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const KEYCHAIN_TIMEOUT_MS = 2000;
const KEYCHAIN_BACKOFF_MS = 60_000;
const LEGACY_KEYCHAIN_SERVICE_NAME = 'Claude Code-credentials';
const SECURITY_BIN = '/usr/bin/security';
function getCacheDir() {
    return path.join(os.homedir(), '.claude', 'plugins', 'claude-hud');
}
function getCachePath() {
    return path.join(getCacheDir(), 'oauth-cache.json');
}
function getBackoffPath() {
    return path.join(getCacheDir(), '.oauth-keychain-backoff');
}
function readCache() {
    try {
        const parsed = JSON.parse(fs.readFileSync(getCachePath(), 'utf8'));
        if (typeof parsed.readAt !== 'number' || !parsed.info)
            return null;
        if (Date.now() - parsed.readAt > CACHE_TTL_MS)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function writeCache(info) {
    try {
        fs.mkdirSync(getCacheDir(), { recursive: true });
        const payload = { readAt: Date.now(), info };
        fs.writeFileSync(getCachePath(), JSON.stringify(payload));
    }
    catch {
        // best-effort
    }
}
function inBackoff() {
    try {
        const ts = Number(fs.readFileSync(getBackoffPath(), 'utf8'));
        return Number.isFinite(ts) && Date.now() - ts < KEYCHAIN_BACKOFF_MS;
    }
    catch {
        return false;
    }
}
function recordBackoff() {
    try {
        fs.mkdirSync(getCacheDir(), { recursive: true });
        fs.writeFileSync(getBackoffPath(), String(Date.now()));
    }
    catch {
        // best-effort
    }
}
function getKeychainServiceNames() {
    const homeDir = os.homedir();
    const configDir = getClaudeConfigDir(homeDir);
    const defaultDir = path.normalize(path.resolve(path.join(homeDir, '.claude')));
    const normalizedConfigDir = path.normalize(path.resolve(configDir));
    const names = new Set();
    if (normalizedConfigDir === defaultDir) {
        names.add(LEGACY_KEYCHAIN_SERVICE_NAME);
    }
    else {
        const hash = createHash('sha256').update(normalizedConfigDir).digest('hex').slice(0, 8);
        names.add(`${LEGACY_KEYCHAIN_SERVICE_NAME}-${hash}`);
    }
    // Always try the legacy/default service as a fallback
    names.add(LEGACY_KEYCHAIN_SERVICE_NAME);
    return [...names];
}
function runSecurity(args) {
    try {
        return execFileSync(SECURITY_BIN, args, {
            encoding: 'utf8',
            timeout: KEYCHAIN_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim() || null;
    }
    catch {
        return null;
    }
}
function readFromKeychain() {
    if (process.platform !== 'darwin')
        return null;
    if (inBackoff())
        return null;
    const services = getKeychainServiceNames();
    let username = null;
    try {
        username = os.userInfo().username.trim() || null;
    }
    catch {
        username = null;
    }
    let sawFailure = false;
    for (const service of services) {
        if (username) {
            const byUser = runSecurity(['find-generic-password', '-s', service, '-a', username, '-w']);
            if (byUser)
                return byUser;
        }
        const anon = runSecurity(['find-generic-password', '-s', service, '-w']);
        if (anon)
            return anon;
        sawFailure = true;
    }
    if (sawFailure)
        recordBackoff();
    return null;
}
function readFromFile() {
    try {
        const configDir = getClaudeConfigDir(os.homedir());
        const credPath = path.join(configDir, '.credentials.json');
        return fs.readFileSync(credPath, 'utf8');
    }
    catch {
        return null;
    }
}
function readFromLibsecret() {
    if (process.platform !== 'linux')
        return null;
    try {
        const out = execFileSync('secret-tool', ['lookup', 'service', LEGACY_KEYCHAIN_SERVICE_NAME, 'account', os.userInfo().username], { encoding: 'utf8', timeout: KEYCHAIN_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
        return out.trim() || null;
    }
    catch {
        // secret-tool not installed or entry missing
        return null;
    }
}
function readFromWindowsCredentialManager() {
    if (process.platform !== 'win32')
        return null;
    try {
        // PowerShell one-liner: load the generic credential and print the password.
        const script = `$c = Get-StoredCredential -Target '${LEGACY_KEYCHAIN_SERVICE_NAME}' -ErrorAction SilentlyContinue; ` +
            `if ($c) { [Runtime.InteropServices.Marshal]::PtrToStringAuto(` +
            `[Runtime.InteropServices.Marshal]::SecureStringToBSTR($c.Password)) }`;
        const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: KEYCHAIN_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
        return out.trim() || null;
    }
    catch {
        // PowerShell missing, CredentialManager module absent, or entry missing
        return null;
    }
}
function parseOAuthPayload(raw, now) {
    try {
        const parsed = JSON.parse(raw);
        const oauth = parsed?.claudeAiOauth ?? parsed;
        // Skip expired tokens (credential was rotated but plan may also have changed)
        const expiresAt = oauth?.expiresAt;
        if (typeof expiresAt === 'number' && expiresAt > 0 && expiresAt <= now) {
            return { subscriptionType: null, rateLimitTier: null };
        }
        return {
            subscriptionType: typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : null,
            rateLimitTier: typeof oauth?.rateLimitTier === 'string' ? oauth.rateLimitTier : null,
        };
    }
    catch {
        return { subscriptionType: null, rateLimitTier: null };
    }
}
export function readOAuthInfo() {
    const cached = readCache();
    if (cached)
        return cached.info;
    const raw = readFromKeychain() ??
        readFromLibsecret() ??
        readFromWindowsCredentialManager() ??
        readFromFile();
    if (!raw) {
        const empty = { subscriptionType: null, rateLimitTier: null };
        writeCache(empty);
        return empty;
    }
    const info = parseOAuthPayload(raw, Date.now());
    writeCache(info);
    return info;
}
export function formatPlanLabel(info) {
    const sub = info.subscriptionType?.toLowerCase();
    if (!sub)
        return null;
    if (sub === 'pro')
        return 'Pro';
    if (sub === 'team')
        return 'Team';
    if (sub === 'enterprise')
        return 'Enterprise';
    if (sub === 'max') {
        const tier = info.rateLimitTier?.toLowerCase() ?? '';
        const match = tier.match(/(\d+)x/);
        return match ? `Max ${match[1]}x` : 'Max';
    }
    return sub.charAt(0).toUpperCase() + sub.slice(1);
}
export function getPlanLabel() {
    return formatPlanLabel(readOAuthInfo());
}
//# sourceMappingURL=oauth.js.map