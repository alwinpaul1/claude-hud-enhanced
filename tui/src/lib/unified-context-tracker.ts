import * as fs from 'fs';
import type { ContextHealth, ContextBreakdown, HudEvent } from './types.js';
import { logger } from './logger.js';

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
  private transcriptOffset = 0;
  private transcriptRemainder = '';
  private transcriptUsage: TranscriptUsage | null = null;

  constructor() {
    this.sessionStart = Date.now();
    this.lastUpdate = this.sessionStart;
  }

  setTranscriptPath(path: string): void {
    if (this.transcriptPath !== path) {
      this.transcriptPath = path;
      this.resetTranscriptState();
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
      this.setTranscriptPath(event.transcriptPath);
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

      if (stat.size < this.transcriptOffset) {
        this.resetTranscriptState();
      }

      const content = this.readTranscriptChunk(stat.size);
      const lines = (this.transcriptRemainder + content).split('\n');
      this.transcriptRemainder = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.applyTranscriptLine(line);
      }

      this.transcriptOffset = stat.size;
      this.transcriptModified = stat.mtimeMs;

      if (this.transcriptUsage) {
        const usage = this.transcriptUsage;
        const totalFromTranscript =
          (usage.input_tokens || 0) +
          (usage.output_tokens || 0) +
          (usage.cache_creation_input_tokens || 0) +
          (usage.cache_read_input_tokens || 0);

        if (totalFromTranscript > 0) {
          this.realTokens = totalFromTranscript;
          this.estimatedDelta = 0;
          this.breakdown = {
            toolInputs: usage.input_tokens || 0,
            toolOutputs: usage.output_tokens || 0,
            messages:
              (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
            other: 0,
          };
        }
      }

      this.recordHistory();
    } catch (err) {
      logger.debug('UnifiedContextTracker', 'Transcript not available, using estimates', { err });
    }
  }

  private readTranscriptChunk(totalSize: number): string {
    if (!this.transcriptPath) return '';
    const start = this.transcriptOffset;
    const length = Math.max(0, totalSize - start);
    if (length === 0) return '';

    const fd = fs.openSync(this.transcriptPath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const bytesRead = fs.readSync(fd, buffer, 0, length, start);
      if (bytesRead <= 0) return '';
      return buffer.subarray(0, bytesRead).toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  }

  private applyTranscriptLine(line: string): void {
    try {
      const entry: TranscriptMessage = JSON.parse(line);
      if (entry.type === 'assistant' && entry.message?.usage) {
        this.transcriptUsage = entry.message.usage;
        if (entry.message.model) {
          this.model = entry.message.model;
        }
      }
    } catch (err) {
      logger.warn('UnifiedContextTracker', 'Failed to parse transcript line', { err });
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
    this.resetTranscriptState();
  }

  private resetTranscriptState(): void {
    this.transcriptOffset = 0;
    this.transcriptRemainder = '';
    this.transcriptUsage = null;
    this.transcriptModified = 0;
    this.realTokens = 0;
    this.estimatedDelta = 0;
    this.breakdown = {
      toolOutputs: 0,
      toolInputs: 0,
      messages: 0,
      other: 0,
    };
    this.tokenHistory = [];
  }
}
