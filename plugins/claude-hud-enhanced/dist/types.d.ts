import type { HudConfig } from './config.js';
import type { GitStatus } from './git.js';
export interface StdinData {
    transcript_path?: string;
    cwd?: string;
    model?: {
        id?: string;
        display_name?: string;
    };
    context_window?: {
        context_window_size?: number;
        used_percentage?: number;
        remaining_percentage?: number;
        current_usage?: {
            input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
        };
    };
}
export interface ToolEntry {
    id: string;
    name: string;
    target?: string;
    status: 'running' | 'completed' | 'error';
    startTime: Date;
    endTime?: Date;
}
export interface AgentEntry {
    id: string;
    type: string;
    model?: string;
    description?: string;
    status: 'running' | 'completed';
    startTime: Date;
    endTime?: Date;
}
export interface TodoItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}
/** Usage window data from the OAuth API */
export interface UsageWindow {
    utilization: number | null;
    resetAt: Date | null;
}
/** Model-specific quota information for compute-intensive models */
export interface ModelQuota {
    modelId: string;
    displayName: string;
    weeklyHoursUsed: number | null;
    weeklyHoursLimit: number | null;
    tokensUsed: number | null;
    tokensLimit: number | null;
    utilization: number | null;
    resetsAt: Date | null;
}
/** Max plan tier information */
export interface MaxPlanInfo {
    tier: 'Max5' | 'Max20' | null;
    tokensPerWindow: number | null;
    isActive: boolean;
}
/** Auto-compaction configuration from server */
export interface CompactionInfo {
    bufferPercent: number;
    isEnabled: boolean;
}
export interface UsageData {
    planName: string | null;
    fiveHour: number | null;
    sevenDay: number | null;
    fiveHourResetAt: Date | null;
    sevenDayResetAt: Date | null;
    apiUnavailable?: boolean;
    modelQuotas?: ModelQuota[];
    maxPlanInfo?: MaxPlanInfo;
    compactionInfo?: CompactionInfo;
    organizationUuid?: string;
    fiveHourResetIn?: string;
    sevenDayResetIn?: string;
}
/** Check if usage limit is reached (either window at 100%) */
export declare function isLimitReached(data: UsageData): boolean;
/** Check if a specific model quota is exhausted */
export declare function isModelQuotaExhausted(data: UsageData, modelId: string): boolean;
/** Get the most restrictive model quota */
export declare function getMostRestrictiveQuota(data: UsageData): ModelQuota | null;
export interface TranscriptData {
    tools: ToolEntry[];
    agents: AgentEntry[];
    todos: TodoItem[];
    sessionStart?: Date;
    lastUserMessage?: string;
}
export interface RenderContext {
    stdin: StdinData;
    transcript: TranscriptData;
    claudeMdCount: number;
    rulesCount: number;
    mcpCount: number;
    hooksCount: number;
    sessionDuration: string;
    gitStatus: GitStatus | null;
    usageData: UsageData | null;
    config: HudConfig;
}
//# sourceMappingURL=types.d.ts.map