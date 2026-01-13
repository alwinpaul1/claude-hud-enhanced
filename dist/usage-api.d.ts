import type { UsageData } from './types.js';
export type { UsageData } from './types.js';
interface ModelQuotaResponse {
    model_id?: string;
    display_name?: string;
    weekly_hours_used?: number;
    weekly_hours_limit?: number;
    tokens_used?: number;
    tokens_limit?: number;
    utilization?: number;
    resets_at?: string;
}
interface UsageApiResponse {
    five_hour?: {
        utilization?: number;
        resets_at?: string;
    };
    seven_day?: {
        utilization?: number;
        resets_at?: string;
    };
    model_quotas?: ModelQuotaResponse[];
    max_plan_type?: string;
    compaction_buffer?: number;
    tokens_per_window?: number;
}
export type UsageApiDeps = {
    homeDir: () => string;
    fetchApi: (accessToken: string, organizationUuid?: string) => Promise<UsageApiResponse | null>;
    fetchUsageLimits: (accessToken: string, organizationUuid?: string) => Promise<UsageApiResponse | null>;
    now: () => number;
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
export declare function getUsage(overrides?: Partial<UsageApiDeps>): Promise<UsageData | null>;
export declare function clearCache(homeDir?: string): void;
//# sourceMappingURL=usage-api.d.ts.map