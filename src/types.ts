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
    used_percentage?: number;      // Direct percentage from API
    remaining_percentage?: number; // Direct percentage from API
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
    // Native percentage fields (Claude Code v2.1.6+)
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
  utilization: number | null;  // 0-100 percentage, null if unavailable
  resetAt: Date | null;
}

/** Model-specific quota information for compute-intensive models */
export interface ModelQuota {
  modelId: string;           // e.g., 'opus_4_5', 'sonnet_4'
  displayName: string;       // e.g., 'Opus 4.5'
  weeklyHoursUsed: number | null;    // Hours used this week
  weeklyHoursLimit: number | null;   // Weekly hour cap
  tokensUsed: number | null;         // Tokens consumed
  tokensLimit: number | null;        // Token limit for this model
  utilization: number | null;        // 0-100 percentage
  resetsAt: Date | null;
}

/** Max plan tier information */
export interface MaxPlanInfo {
  tier: 'Max5' | 'Max20' | null;     // Max5 = 88k tokens/window, Max20 = 220k tokens/window
  tokensPerWindow: number | null;    // Calculated based on tier
  isActive: boolean;
}

/** Auto-compaction configuration from server */
export interface CompactionInfo {
  bufferPercent: number;     // Typically 80 or 90, percentage at which auto-compact triggers
  isEnabled: boolean;
}

export interface UsageData {
  planName: string | null;  // 'Max', 'Pro', or null for API users
  fiveHour: number | null;  // 0-100 percentage, null if unavailable
  sevenDay: number | null;  // 0-100 percentage, null if unavailable
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  apiUnavailable?: boolean; // true if API call failed (user should check DEBUG logs)
  apiError?: string; // short error reason (e.g., 401, timeout)

  // Enhanced data (2026 features)
  modelQuotas?: ModelQuota[];        // Per-model quotas (esp. Opus 4.5)
  maxPlanInfo?: MaxPlanInfo;         // Max5/Max20 tier details
  compactionInfo?: CompactionInfo;   // Auto-compaction threshold
  organizationUuid?: string;         // Organization ID if available

  // Time-to-reset countdowns (calculated)
  fiveHourResetIn?: string;          // Human-readable countdown, e.g., "2h 15m"
  sevenDayResetIn?: string;          // Human-readable countdown
}

/** Check if usage limit is reached (either window at 100%) */
export function isLimitReached(data: UsageData): boolean {
  return data.fiveHour === 100 || data.sevenDay === 100;
}

/** Check if a specific model quota is exhausted */
export function isModelQuotaExhausted(data: UsageData, modelId: string): boolean {
  const quota = data.modelQuotas?.find(q => q.modelId === modelId);
  return quota?.utilization === 100;
}

/** Get the most restrictive model quota */
export function getMostRestrictiveQuota(data: UsageData): ModelQuota | null {
  if (!data.modelQuotas || data.modelQuotas.length === 0) return null;
  return data.modelQuotas.reduce((max, q) =>
    (q.utilization ?? 0) > (max.utilization ?? 0) ? q : max
  );
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoItem[];
  sessionStart?: Date;
  lastUserMessage?: string;  // User's most recent text message
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
  extraLabel: string | null;
}
