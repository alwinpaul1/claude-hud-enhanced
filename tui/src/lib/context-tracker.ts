import type { HudEvent, ContextState } from './types.js';

const MAX_TOKENS = 200000;
const CHARS_PER_TOKEN = 4;
const COMPACTION_THRESHOLD = 0.85;
const WARNING_THRESHOLD = 0.70;

export interface ContextHealth {
  tokens: number;
  percent: number;
  remaining: number;
  maxTokens: number;
  burnRate: number;
  status: 'healthy' | 'warning' | 'critical';
  shouldCompact: boolean;
  breakdown: ContextBreakdown;
  sessionStart: number;
  lastUpdate: number;
}

export interface ContextBreakdown {
  toolOutputs: number;
  toolInputs: number;
  messages: number;
  other: number;
}

interface TokenSample {
  tokens: number;
  timestamp: number;
}

export class ContextTracker {
  private totalTokens = 0;
  private breakdown: ContextBreakdown = {
    toolOutputs: 0,
    toolInputs: 0,
    messages: 0,
    other: 0,
  };
  private tokenHistory: TokenSample[] = [];
  private sessionStart: number;
  private lastUpdate: number;

  constructor() {
    this.sessionStart = Date.now();
    this.lastUpdate = this.sessionStart;
  }

  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  processEvent(event: HudEvent): void {
    this.lastUpdate = Date.now();

    if (event.input) {
      const inputTokens = this.estimateTokens(JSON.stringify(event.input));
      this.breakdown.toolInputs += inputTokens;
      this.totalTokens += inputTokens;
    }

    if (event.response) {
      const outputTokens = this.estimateTokens(JSON.stringify(event.response));
      this.breakdown.toolOutputs += outputTokens;
      this.totalTokens += outputTokens;
    }

    this.tokenHistory.push({
      tokens: this.totalTokens,
      timestamp: this.lastUpdate,
    });

    if (this.tokenHistory.length > 100) {
      this.tokenHistory = this.tokenHistory.slice(-50);
    }
  }

  addMessageTokens(tokens: number): void {
    this.breakdown.messages += tokens;
    this.totalTokens += tokens;
    this.lastUpdate = Date.now();
  }

  calculateBurnRate(): number {
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

  getStatus(): 'healthy' | 'warning' | 'critical' {
    const percent = this.totalTokens / MAX_TOKENS;
    if (percent >= COMPACTION_THRESHOLD) return 'critical';
    if (percent >= WARNING_THRESHOLD) return 'warning';
    return 'healthy';
  }

  getHealth(): ContextHealth {
    const percent = Math.min((this.totalTokens / MAX_TOKENS) * 100, 100);
    const remaining = Math.max(MAX_TOKENS - this.totalTokens, 0);

    return {
      tokens: Math.round(this.totalTokens),
      percent: Math.round(percent),
      remaining: Math.round(remaining),
      maxTokens: MAX_TOKENS,
      burnRate: this.calculateBurnRate(),
      status: this.getStatus(),
      shouldCompact: percent >= COMPACTION_THRESHOLD * 100,
      breakdown: { ...this.breakdown },
      sessionStart: this.sessionStart,
      lastUpdate: this.lastUpdate,
    };
  }

  getContextState(): ContextState {
    const health = this.getHealth();
    return {
      tokens: health.tokens,
      percent: health.percent,
      remaining: health.remaining,
      maxTokens: health.maxTokens,
    };
  }

  reset(): void {
    this.totalTokens = 0;
    this.breakdown = {
      toolOutputs: 0,
      toolInputs: 0,
      messages: 0,
      other: 0,
    };
    this.tokenHistory = [];
    this.sessionStart = Date.now();
    this.lastUpdate = this.sessionStart;
  }
}
