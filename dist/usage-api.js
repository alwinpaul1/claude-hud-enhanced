import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { createDebug } from './debug.js';
const debug = createDebug('usage');
// File-based cache (HUD runs as new process each render, so in-memory cache won't persist)
const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_FAILURE_TTL_MS = 15_000; // 15 seconds for failed requests
function getCachePath(homeDir) {
    return path.join(homeDir, '.claude', 'plugins', 'claude-hud', '.usage-cache.json');
}
function readCache(homeDir, now) {
    try {
        const cachePath = getCachePath(homeDir);
        if (!fs.existsSync(cachePath))
            return null;
        const content = fs.readFileSync(cachePath, 'utf8');
        const cache = JSON.parse(content);
        // Check TTL - use shorter TTL for failure results
        const ttl = cache.data.apiUnavailable ? CACHE_FAILURE_TTL_MS : CACHE_TTL_MS;
        if (now - cache.timestamp >= ttl)
            return null;
        // JSON.stringify converts Date to ISO string, so we need to reconvert on read.
        // new Date() handles both Date objects and ISO strings safely.
        const data = cache.data;
        if (data.fiveHourResetAt) {
            data.fiveHourResetAt = new Date(data.fiveHourResetAt);
        }
        if (data.sevenDayResetAt) {
            data.sevenDayResetAt = new Date(data.sevenDayResetAt);
        }
        return data;
    }
    catch {
        return null;
    }
}
function writeCache(homeDir, data, timestamp) {
    try {
        const cachePath = getCachePath(homeDir);
        const cacheDir = path.dirname(cachePath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        const cache = { data, timestamp };
        fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
    }
    catch {
        // Ignore cache write failures
    }
}
const defaultDeps = {
    homeDir: () => os.homedir(),
    fetchApi: fetchUsageApi,
    fetchUsageLimits: fetchUsageLimitsApi,
    now: () => Date.now(),
};
/**
 * Get OAuth usage data from Anthropic API.
 * Returns null if user is an API user (no OAuth credentials) or credentials are expired.
 * Returns { apiUnavailable: true, ... } if API call fails (to show warning in HUD).
 *
 * Uses file-based cache since HUD runs as a new process each render (~300ms).
 * Cache TTL: 60s for success, 15s for failures.
 *
 * Enhanced (2026): Also fetches model quotas, max plan info, and compaction settings.
 */
export async function getUsage(overrides = {}) {
    const deps = { ...defaultDeps, ...overrides };
    const now = deps.now();
    const homeDir = deps.homeDir();
    // Check file-based cache first
    const cached = readCache(homeDir, now);
    if (cached) {
        // Update time-to-reset countdowns (these change every render)
        if (cached.fiveHourResetAt) {
            cached.fiveHourResetIn = formatTimeToReset(cached.fiveHourResetAt, now);
        }
        if (cached.sevenDayResetAt) {
            cached.sevenDayResetIn = formatTimeToReset(cached.sevenDayResetAt, now);
        }
        return cached;
    }
    try {
        const credentials = readCredentials(homeDir, now);
        if (!credentials) {
            return null;
        }
        const { accessToken, subscriptionType, organizationUuid, rateLimitTier } = credentials;
        // Determine plan name from subscriptionType (pass true since we have OAuth token)
        const planName = getPlanName(subscriptionType, true);
        if (!planName) {
            // API user, no usage limits to show
            debug('No plan name determined, likely API user');
            return null;
        }
        // Fetch usage from both APIs in parallel for comprehensive data
        const [apiResponse, usageLimitsResponse] = await Promise.all([
            deps.fetchApi(accessToken, organizationUuid),
            deps.fetchUsageLimits(accessToken, organizationUuid),
        ]);
        // Merge responses, preferring the more detailed one
        const mergedResponse = mergeApiResponses(apiResponse, usageLimitsResponse);
        if (!mergedResponse) {
            // Both API calls failed, cache the failure to prevent retry storms
            const failureResult = {
                planName,
                fiveHour: null,
                sevenDay: null,
                fiveHourResetAt: null,
                sevenDayResetAt: null,
                apiUnavailable: true,
            };
            writeCache(homeDir, failureResult, now);
            return failureResult;
        }
        // Parse response - API returns 0-100 percentage directly
        // Clamp to 0-100 and handle NaN/Infinity
        const fiveHour = parseUtilization(mergedResponse.five_hour?.utilization);
        const sevenDay = parseUtilization(mergedResponse.seven_day?.utilization);
        const fiveHourResetAt = parseDate(mergedResponse.five_hour?.resets_at);
        const sevenDayResetAt = parseDate(mergedResponse.seven_day?.resets_at);
        // Parse enhanced 2026 features
        const modelQuotas = parseModelQuotas(mergedResponse.model_quotas);
        const maxPlanInfo = parseMaxPlanInfo(mergedResponse.max_plan_type, mergedResponse.tokens_per_window, rateLimitTier);
        const compactionInfo = parseCompactionInfo(mergedResponse.compaction_buffer);
        const result = {
            planName,
            fiveHour,
            sevenDay,
            fiveHourResetAt,
            sevenDayResetAt,
            // Enhanced data
            modelQuotas: modelQuotas.length > 0 ? modelQuotas : undefined,
            maxPlanInfo: maxPlanInfo.tier ? maxPlanInfo : undefined,
            compactionInfo: compactionInfo.isEnabled ? compactionInfo : undefined,
            organizationUuid,
            // Time-to-reset countdowns
            fiveHourResetIn: fiveHourResetAt ? formatTimeToReset(fiveHourResetAt, now) : undefined,
            sevenDayResetIn: sevenDayResetAt ? formatTimeToReset(sevenDayResetAt, now) : undefined,
        };
        // Write to file cache
        writeCache(homeDir, result, now);
        return result;
    }
    catch (error) {
        debug('getUsage failed:', error);
        return null;
    }
}
/** Merge responses from both API endpoints */
function mergeApiResponses(primary, secondary) {
    if (!primary && !secondary)
        return null;
    if (!primary)
        return secondary;
    if (!secondary)
        return primary;
    return {
        five_hour: primary.five_hour ?? secondary.five_hour,
        seven_day: primary.seven_day ?? secondary.seven_day,
        model_quotas: primary.model_quotas ?? secondary.model_quotas,
        max_plan_type: primary.max_plan_type ?? secondary.max_plan_type,
        compaction_buffer: primary.compaction_buffer ?? secondary.compaction_buffer,
        tokens_per_window: primary.tokens_per_window ?? secondary.tokens_per_window,
    };
}
/** Parse model quotas from API response */
function parseModelQuotas(quotas) {
    if (!quotas || !Array.isArray(quotas))
        return [];
    return quotas.map(q => ({
        modelId: q.model_id ?? 'unknown',
        displayName: q.display_name ?? q.model_id ?? 'Unknown Model',
        weeklyHoursUsed: q.weekly_hours_used ?? null,
        weeklyHoursLimit: q.weekly_hours_limit ?? null,
        tokensUsed: q.tokens_used ?? null,
        tokensLimit: q.tokens_limit ?? null,
        utilization: parseUtilization(q.utilization),
        resetsAt: parseDate(q.resets_at),
    }));
}
/** Parse Max plan tier information */
function parseMaxPlanInfo(maxPlanType, tokensPerWindow, rateLimitTier) {
    let tier = null;
    let calculatedTokens = null;
    // Check explicit max_plan_type first
    if (maxPlanType) {
        const lower = maxPlanType.toLowerCase();
        if (lower.includes('max20') || lower === '20') {
            tier = 'Max20';
            calculatedTokens = tokensPerWindow ?? 220_000;
        }
        else if (lower.includes('max5') || lower === '5') {
            tier = 'Max5';
            calculatedTokens = tokensPerWindow ?? 88_000;
        }
    }
    // Fallback to rateLimitTier from credentials
    if (!tier && rateLimitTier) {
        const lower = rateLimitTier.toLowerCase();
        if (lower.includes('max20') || lower.includes('tier_20')) {
            tier = 'Max20';
            calculatedTokens = 220_000;
        }
        else if (lower.includes('max5') || lower.includes('tier_5')) {
            tier = 'Max5';
            calculatedTokens = 88_000;
        }
    }
    return {
        tier,
        tokensPerWindow: calculatedTokens,
        isActive: tier !== null,
    };
}
/** Parse compaction buffer settings */
function parseCompactionInfo(bufferPercent) {
    if (bufferPercent == null || !Number.isFinite(bufferPercent)) {
        // Default to 80% if not specified (common default)
        return { bufferPercent: 80, isEnabled: false };
    }
    return {
        bufferPercent: Math.round(Math.max(50, Math.min(100, bufferPercent))),
        isEnabled: true,
    };
}
/** Format time remaining until reset as human-readable string */
function formatTimeToReset(resetAt, now) {
    const diffMs = resetAt.getTime() - now;
    if (diffMs <= 0)
        return 'now';
    const totalMins = Math.ceil(diffMs / 60000);
    if (totalMins < 60) {
        return `${totalMins}m`;
    }
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours < 24) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
/**
 * Read credentials from macOS Keychain using security command
 * This is where Claude Code stores credentials on macOS
 */
function readKeychainCredentials() {
    if (process.platform !== 'darwin') {
        return null;
    }
    try {
        const { execSync } = require('child_process');
        const user = process.env.USER || os.userInfo().username;
        const result = execSync(`security find-generic-password -a "${user}" -s "Claude Code-credentials" -w 2>/dev/null`, { encoding: 'utf8', timeout: 2000 }).trim();
        if (result) {
            const data = JSON.parse(result);
            debug('Read credentials from macOS Keychain');
            return data;
        }
    }
    catch (error) {
        debug('Keychain read failed (expected on non-macOS or if not stored):', error);
    }
    return null;
}
function readCredentials(homeDir, now) {
    const credentialsPath = path.join(homeDir, '.claude', '.credentials.json');
    let data = null;
    // Try file first
    if (fs.existsSync(credentialsPath)) {
        try {
            const content = fs.readFileSync(credentialsPath, 'utf8');
            data = JSON.parse(content);
            debug('Read credentials from file:', credentialsPath);
        }
        catch (error) {
            debug('Failed to read credentials file:', error);
        }
    }
    // Fallback to macOS Keychain if file doesn't exist or is invalid
    if (!data || !data.claudeAiOauth?.accessToken) {
        data = readKeychainCredentials();
    }
    if (!data) {
        debug('No credentials found in file or Keychain');
        return null;
    }
    const accessToken = data.claudeAiOauth?.accessToken;
    const subscriptionType = data.claudeAiOauth?.subscriptionType ?? '';
    const organizationUuid = data.oauthAccount?.organizationUuid;
    const rateLimitTier = data.claudeAiOauth?.rateLimitTier;
    if (!accessToken) {
        debug('No access token in credentials');
        return null;
    }
    // Check if token is expired (expiresAt is Unix ms timestamp)
    // Use != null to handle expiresAt=0 correctly (would be expired)
    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (expiresAt != null && expiresAt <= now) {
        debug('Access token expired at:', new Date(expiresAt));
        return null;
    }
    debug('Credentials loaded, subscriptionType:', subscriptionType || '(not set)');
    return { accessToken, subscriptionType, organizationUuid, rateLimitTier };
}
function getPlanName(subscriptionType, hasOAuthToken = false) {
    const lower = subscriptionType.toLowerCase();
    if (lower.includes('max'))
        return 'Max';
    if (lower.includes('pro'))
        return 'Pro';
    if (lower.includes('team'))
        return 'Team';
    // API users have 'api' in their subscriptionType
    if (lower.includes('api'))
        return null;
    // If we have OAuth credentials but no subscription type, assume Pro (most common)
    // This happens when credentials are stored in Keychain without full metadata
    if (!subscriptionType && hasOAuthToken) {
        debug('No subscriptionType but has OAuth token, defaulting to Pro');
        return 'Pro';
    }
    if (!subscriptionType)
        return null;
    // Unknown subscription type - show it capitalized
    return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}
/** Parse utilization value, clamping to 0-100 and handling NaN/Infinity */
function parseUtilization(value) {
    if (value == null)
        return null;
    if (!Number.isFinite(value))
        return null; // Handles NaN and Infinity
    return Math.round(Math.max(0, Math.min(100, value)));
}
/** Parse ISO date string safely, returning null for invalid dates */
function parseDate(dateStr) {
    if (!dateStr)
        return null;
    const date = new Date(dateStr);
    // Check for Invalid Date
    if (isNaN(date.getTime())) {
        debug('Invalid date string:', dateStr);
        return null;
    }
    return date;
}
/** Fetch from the original Anthropic OAuth usage endpoint */
function fetchUsageApi(accessToken, organizationUuid) {
    return new Promise((resolve) => {
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': 'claude-hud-enhanced/1.0',
        };
        if (organizationUuid) {
            headers['x-organization-uuid'] = organizationUuid;
        }
        const options = {
            hostname: 'api.anthropic.com',
            path: '/api/oauth/usage',
            method: 'GET',
            headers,
            timeout: 5000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk.toString();
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    debug('Anthropic API returned non-200 status:', res.statusCode);
                    resolve(null);
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    debug('Anthropic API response:', parsed);
                    resolve(parsed);
                }
                catch (error) {
                    debug('Failed to parse Anthropic API response:', error);
                    resolve(null);
                }
            });
        });
        req.on('error', (error) => {
            debug('Anthropic API request error:', error);
            resolve(null);
        });
        req.on('timeout', () => {
            debug('Anthropic API request timeout');
            req.destroy();
            resolve(null);
        });
        req.end();
    });
}
/**
 * Fetch from the Claude.ai usage_limits endpoint (enhanced 2026 data)
 * This endpoint provides model quotas, max plan info, and compaction settings
 */
function fetchUsageLimitsApi(accessToken, organizationUuid) {
    return new Promise((resolve) => {
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'claude-hud-enhanced/1.0',
        };
        if (organizationUuid) {
            headers['x-organization-uuid'] = organizationUuid;
        }
        const options = {
            hostname: 'api.claude.ai',
            path: '/api/v1/usage_limits',
            method: 'GET',
            headers,
            timeout: 5000,
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk.toString();
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    debug('Claude.ai usage_limits API returned non-200 status:', res.statusCode, data);
                    resolve(null);
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    debug('Claude.ai usage_limits response:', parsed);
                    resolve(parsed);
                }
                catch (error) {
                    debug('Failed to parse Claude.ai usage_limits response:', error);
                    resolve(null);
                }
            });
        });
        req.on('error', (error) => {
            debug('Claude.ai usage_limits request error:', error);
            resolve(null);
        });
        req.on('timeout', () => {
            debug('Claude.ai usage_limits request timeout');
            req.destroy();
            resolve(null);
        });
        req.end();
    });
}
// Export for testing
export function clearCache(homeDir) {
    if (homeDir) {
        try {
            const cachePath = getCachePath(homeDir);
            if (fs.existsSync(cachePath)) {
                fs.unlinkSync(cachePath);
            }
        }
        catch {
            // Ignore
        }
    }
}
//# sourceMappingURL=usage-api.js.map