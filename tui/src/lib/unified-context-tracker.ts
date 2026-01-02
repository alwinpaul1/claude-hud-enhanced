import * as fs from 'fs';
import type { ContextHealth, ContextBreakdown, HudEvent } from './types.js';

const COMPACTION_THRESHOLD = 0.85;
const WARNING_THRESHOLD = 0.7;
const SPARKLINE_SAMPLES = 20;
const CHARS_PER_TOKEN = 4;

interface TokenSample {
  tokens: number;
  timestamp: number;
}

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

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-5': 200000,
  'claude-sonnet-4': 200000,
  'claude-haiku-3-5': 200000,
  default: 200000,
};

function getContextLimit(model: string | null): number {
  if (!model) return MODEL_CONTEXT_LIMITS['default'];
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (model.includes(key)) return limit;
  }
  return MODEL_CONTEXT_LIMITS['default'];
}

export class UnifiedContextTracker {
  private transcriptPath: string | null = null;
  private transcriptModified: number = 0;
  private model: string | null = null;
  private realTokens: number = 0;
  private estimatedDelta: number = 0;
  private breakdown: ContextBreakdown = {
    toolOutputs: 0,
    toolInputs: 0,
    messages: 0,
    other: 0,
  };
  private tokenHistory: TokenSample[] = [];
  private sessionStart: number;
  private lastUpdate: number;
  private compactionCount: number = 0;

  constructor() {
    this.sessionStart = Date.now();
    this.lastUpdate = this.sessionStart;
  }

  setTranscriptPath(path: string): void {
    if (this.transcriptPath !== path) {
      this.transcriptPath = path;
      this.readTranscript();
    }
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  processEvent(event: HudEvent): void {
    this.lastUpdate = Date.now();

    if (event.transcriptPath && event.transcriptPath !== this.transcriptPath) {
      this.transcriptPath = event.transcriptPath;
    }

    if (event.event === 'PostToolUse') {
      if (event.input) {
        const inputTokens = this.estimateTokens(JSON.stringify(event.input));
        this.estimatedDelta += inputTokens;
        this.breakdown.toolInputs += inputTokens;
      }
      if (event.response) {
        const outputTokens = this.estimateTokens(JSON.stringify(event.response));
        this.estimatedDelta += outputTokens;
        this.breakdown.toolOutputs += outputTokens;
      }
      this.recordHistory();
    }

    if (event.event === 'Stop') {
      this.readTranscript();
    }

    if (event.event === 'PreCompact') {
      this.compactionCount++;
    }
  }

  private readTranscript(): void {
    if (!this.transcriptPath) return;

    try {
      const stat = fs.statSync(this.transcriptPath);
      if (stat.mtimeMs === this.transcriptModified) return;

      const content = fs.readFileSync(this.transcriptPath, 'utf-8');
      const lines = content.trim().split('\n');

      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;

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
            if (entry.message.model) {
              this.model = entry.message.model;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      const totalFromTranscript =
        inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;

      if (totalFromTranscript > 0) {
        this.realTokens = totalFromTranscript;
        this.estimatedDelta = 0;
        this.breakdown = {
          toolInputs: inputTokens,
          toolOutputs: outputTokens,
          messages: cacheCreationTokens + cacheReadTokens,
          other: 0,
        };
      }

      this.transcriptModified = stat.mtimeMs;
      this.recordHistory();
    } catch {
      // Transcript not available, keep using estimates
    }
  }

  private recordHistory(): void {
    const currentTokens = this.getTotalTokens();
    this.tokenHistory.push({
      tokens: currentTokens,
      timestamp: Date.now(),
    });
    if (this.tokenHistory.length > 100) {
      this.tokenHistory = this.tokenHistory.slice(-50);
    }
  }

  private getTotalTokens(): number {
    return this.realTokens + this.estimatedDelta;
  }

  private calculateBurnRate(): number {
    if (this.tokenHistory.length < 2) return 0;

    const recent = this.tokenHistory.slice(-10);
    if (recent.length < 2) return 0;

    const first = recent[0];
    const last = recent[recent.length - 1];
    const timeDiffMinutes = (last.timestamp - first.timestamp) / 60000;

    if (timeDiffMinutes < 0.1) return 0;

    const tokenDiff = last.tokens - first.tokens;
    return Math.round(tokenDiff / timeDiffMinutes);
  }

  private getStatus(): 'healthy' | 'warning' | 'critical' {
    const maxTokens = getContextLimit(this.model);
    const percent = this.getTotalTokens() / maxTokens;
    if (percent >= COMPACTION_THRESHOLD) return 'critical';
    if (percent >= WARNING_THRESHOLD) return 'warning';
    return 'healthy';
  }

  private getTokenHistory(): number[] {
    const history = this.tokenHistory.slice(-SPARKLINE_SAMPLES);
    return history.map((s) => s.tokens);
  }

  getHealth(): ContextHealth {
    const maxTokens = getContextLimit(this.model);
    const totalTokens = this.getTotalTokens();
    const percent = Math.min((totalTokens / maxTokens) * 100, 100);
    const remaining = Math.max(maxTokens - totalTokens, 0);

    return {
      tokens: Math.round(totalTokens),
      percent: Math.round(percent),
      remaining: Math.round(remaining),
      maxTokens,
      burnRate: this.calculateBurnRate(),
      status: this.getStatus(),
      shouldCompact: percent >= COMPACTION_THRESHOLD * 100,
      breakdown: { ...this.breakdown },
      sessionStart: this.sessionStart,
      lastUpdate: this.lastUpdate,
      tokenHistory: this.getTokenHistory(),
    };
  }

  getCompactionCount(): number {
    return this.compactionCount;
  }

  getModel(): string | null {
    return this.model;
  }

  reset(): void {
    this.realTokens = 0;
    this.estimatedDelta = 0;
    this.breakdown = {
      toolOutputs: 0,
      toolInputs: 0,
      messages: 0,
      other: 0,
    };
    this.tokenHistory = [];
    this.sessionStart = Date.now();
    this.lastUpdate = this.sessionStart;
    this.compactionCount = 0;
    this.transcriptModified = 0;
  }
}
