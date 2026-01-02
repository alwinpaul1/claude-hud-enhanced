import type { CostEstimate, HudEvent } from './types.js';

// Anthropic pricing per 1M tokens (as of Jan 2025)
// Using Claude Sonnet 4 pricing as default
const PRICING = {
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 15.0, output: 75.0 },
  haiku: { input: 0.25, output: 1.25 },
};

const CHARS_PER_TOKEN = 4;

export class CostTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private model: keyof typeof PRICING = 'sonnet';

  setModel(model: string): void {
    if (model.includes('opus')) {
      this.model = 'opus';
    } else if (model.includes('haiku')) {
      this.model = 'haiku';
    } else {
      this.model = 'sonnet';
    }
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  processEvent(event: HudEvent): void {
    if (event.event === 'PostToolUse') {
      // Tool inputs are sent to Claude (input tokens)
      if (event.input) {
        this.inputTokens += this.estimateTokens(JSON.stringify(event.input));
      }
      // Tool responses come back (output counted differently)
      if (event.response) {
        this.outputTokens += this.estimateTokens(JSON.stringify(event.response));
      }
    } else if (event.event === 'UserPromptSubmit' && event.prompt) {
      // User prompts are input
      this.inputTokens += this.estimateTokens(event.prompt);
    }
  }

  getCost(): CostEstimate {
    const pricing = PRICING[this.model];
    const inputCost = (this.inputTokens / 1_000_000) * pricing.input;
    const outputCost = (this.outputTokens / 1_000_000) * pricing.output;

    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
    };
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}
