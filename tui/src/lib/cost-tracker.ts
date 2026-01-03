import type { CostEstimate, HudEvent } from './types.js';
import { CHARS_PER_TOKEN, PRICING_STALE_DAYS } from './constants.js';

export interface ModelPricing {
  input: number;
  output: number;
}

export interface PricingConfig {
  sonnet: ModelPricing;
  opus: ModelPricing;
  haiku: ModelPricing;
  lastUpdated: string;
}

const DEFAULT_PRICING: PricingConfig = {
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 15.0, output: 75.0 },
  haiku: { input: 0.25, output: 1.25 },
  lastUpdated: '2025-01-01',
};

export function isPricingStale(lastUpdated: string): boolean {
  const updateDate = new Date(lastUpdated);
  const now = new Date();
  const daysSinceUpdate = (now.getTime() - updateDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceUpdate > PRICING_STALE_DAYS;
}

export function mergePricing(
  base: PricingConfig,
  override?: Partial<PricingConfig>,
): PricingConfig {
  if (!override) return base;
  return {
    sonnet: override.sonnet ?? base.sonnet,
    opus: override.opus ?? base.opus,
    haiku: override.haiku ?? base.haiku,
    lastUpdated: override.lastUpdated ?? base.lastUpdated,
  };
}

export class CostTracker {
  private inputTokens = 0;
  private outputTokens = 0;
  private model: keyof Omit<PricingConfig, 'lastUpdated'> = 'sonnet';
  private pricing: PricingConfig = DEFAULT_PRICING;

  setPricing(config: Partial<PricingConfig>): void {
    this.pricing = mergePricing(DEFAULT_PRICING, config);
  }

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
      if (event.input) {
        this.inputTokens += this.estimateTokens(JSON.stringify(event.input));
      }
      if (event.response) {
        this.outputTokens += this.estimateTokens(JSON.stringify(event.response));
      }
    } else if (event.event === 'UserPromptSubmit' && event.prompt) {
      this.inputTokens += this.estimateTokens(event.prompt);
    }
  }

  getCost(): CostEstimate {
    const modelPricing = this.pricing[this.model];
    const inputCost = (this.inputTokens / 1_000_000) * modelPricing.input;
    const outputCost = (this.outputTokens / 1_000_000) * modelPricing.output;
    const pricingStale = isPricingStale(this.pricing.lastUpdated);

    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      pricingStale,
    };
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}
