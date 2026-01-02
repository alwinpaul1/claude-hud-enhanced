import * as fs from 'fs';
import type { ContextHealth } from './types.js';

interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface TranscriptMessage {
  message?: {
    model?: string;
    usage?: TranscriptUsage;
  };
  type?: string;
}

export interface SessionTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  messageCount: number;
  model: string | null;
}

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-5': 200000,
  'claude-sonnet-4': 200000,
  'claude-haiku-3-5': 200000,
  'default': 200000,
};

function getContextLimit(model: string | null): number {
  if (!model) return MODEL_CONTEXT_LIMITS['default'];
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (model.includes(key)) return limit;
  }
  return MODEL_CONTEXT_LIMITS['default'];
}

export class TranscriptReader {
  private cache: SessionTokens | null = null;
  private lastPath: string | null = null;
  private lastModified: number = 0;

  read(transcriptPath: string | undefined): SessionTokens | null {
    if (!transcriptPath) return null;

    try {
      const stat = fs.statSync(transcriptPath);
      const mtime = stat.mtimeMs;

      if (this.lastPath === transcriptPath && this.lastModified === mtime && this.cache) {
        return this.cache;
      }

      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const lines = content.trim().split('\n');

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;
      let messageCount = 0;
      let model: string | null = null;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry: TranscriptMessage = JSON.parse(line);
          if (entry.type === 'assistant' && entry.message?.usage) {
            const usage = entry.message.usage;
            inputTokens = usage.input_tokens || 0;
            outputTokens = usage.output_tokens || 0;
            cacheCreationTokens = usage.cache_creation_input_tokens || 0;
            cacheReadTokens = usage.cache_read_input_tokens || 0;
            messageCount++;
            if (entry.message.model) {
              model = entry.message.model;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      this.cache = {
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        totalTokens: inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
        messageCount,
        model,
      };
      this.lastPath = transcriptPath;
      this.lastModified = mtime;

      return this.cache;
    } catch {
      return null;
    }
  }

  getContextHealth(transcriptPath: string | undefined): ContextHealth | null {
    const tokens = this.read(transcriptPath);
    if (!tokens) return null;

    const maxTokens = getContextLimit(tokens.model);
    const totalUsed = tokens.inputTokens + tokens.outputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens;
    const percent = Math.min((totalUsed / maxTokens) * 100, 100);
    const remaining = Math.max(maxTokens - totalUsed, 0);

    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (percent >= 85) status = 'critical';
    else if (percent >= 70) status = 'warning';

    return {
      tokens: totalUsed,
      percent: Math.round(percent),
      remaining,
      maxTokens,
      burnRate: 0,
      status,
      shouldCompact: percent >= 85,
      breakdown: {
        toolOutputs: tokens.outputTokens,
        toolInputs: tokens.inputTokens,
        messages: tokens.cacheCreationTokens + tokens.cacheReadTokens,
        other: 0,
      },
      sessionStart: Date.now(),
      lastUpdate: Date.now(),
      tokenHistory: [totalUsed],
    };
  }

  invalidate(): void {
    this.cache = null;
    this.lastPath = null;
    this.lastModified = 0;
  }
}
