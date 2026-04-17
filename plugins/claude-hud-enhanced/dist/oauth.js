import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getClaudeConfigDir } from './claude-config-dir.js';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const KEYCHAIN_TIMEOUT_MS = 1500;
function getCachePath() {
    return path.join(os.homedir(), '.claude', 'plugins', 'claude-hud', 'oauth-cache.json');
}
function readCache() {
    try {
        const raw = fs.readFileSync(getCachePath(), 'utf8');
        const parsed = JSON.parse(raw);
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
        const cachePath = getCachePath();
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        const payload = { readAt: Date.now(), info };
        fs.writeFileSync(cachePath, JSON.stringify(payload));
    }
    catch {
        // best-effort cache
    }
}
function readFromKeychain() {
    if (process.platform !== 'darwin')
        return null;
    try {
        const out = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-a', os.userInfo().username, '-w'], { encoding: 'utf8', timeout: KEYCHAIN_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] });
        return out.trim() || null;
    }
    catch {
        return null;
    }
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
function parseOAuthPayload(raw) {
    try {
        const parsed = JSON.parse(raw);
        const oauth = parsed?.claudeAiOauth ?? parsed;
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
    const raw = readFromKeychain() ?? readFromFile();
    if (!raw) {
        const empty = { subscriptionType: null, rateLimitTier: null };
        writeCache(empty);
        return empty;
    }
    const info = parseOAuthPayload(raw);
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