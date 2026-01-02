import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
}

interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

interface DailyModelTokens {
  date: string;
  tokensByModel: Record<string, number>;
}

interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage>;
  totalSessions: number;
  totalMessages: number;
  longestSession?: {
    sessionId: string;
    duration: number;
    messageCount: number;
    timestamp: string;
  };
}

export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  todayTokens: number;
  todayMessages: number;
  todaySessions: number;
  totalSessions: number;
  totalMessages: number;
}

const STATS_PATH = path.join(os.homedir(), '.claude', 'stats-cache.json');

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function readStats(): TokenStats | null {
  try {
    if (!fs.existsSync(STATS_PATH)) {
      return null;
    }
    const content = fs.readFileSync(STATS_PATH, 'utf-8');
    const stats: StatsCache = JSON.parse(content);

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    for (const usage of Object.values(stats.modelUsage || {})) {
      inputTokens += usage.inputTokens || 0;
      outputTokens += usage.outputTokens || 0;
      cacheReadTokens += usage.cacheReadInputTokens || 0;
      cacheCreationTokens += usage.cacheCreationInputTokens || 0;
    }

    const today = formatDate(new Date());
    const todayActivity = stats.dailyActivity?.find((d) => d.date === today);
    const todayTokensEntry = stats.dailyModelTokens?.find((d) => d.date === today);

    let todayTokens = 0;
    if (todayTokensEntry) {
      todayTokens = Object.values(todayTokensEntry.tokensByModel).reduce((a, b) => a + b, 0);
    }

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens: inputTokens + outputTokens,
      todayTokens,
      todayMessages: todayActivity?.messageCount || 0,
      todaySessions: todayActivity?.sessionCount || 0,
      totalSessions: stats.totalSessions || 0,
      totalMessages: stats.totalMessages || 0,
    };
  } catch {
    return null;
  }
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}

export class StatsReader {
  private data: TokenStats | null = null;
  private lastRead: number = 0;
  private readonly refreshInterval = 30000;

  read(): TokenStats | null {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      this.data = readStats();
      this.lastRead = now;
    }
    return this.data;
  }

  forceRefresh(): TokenStats | null {
    this.data = readStats();
    this.lastRead = Date.now();
    return this.data;
  }
}
