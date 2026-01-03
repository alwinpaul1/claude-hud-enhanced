import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker, isPricingStale, mergePricing } from './cost-tracker.js';
import type { HudEvent } from './types.js';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe('processEvent', () => {
    it('should track input tokens from PostToolUse', () => {
      const event: HudEvent = {
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/path/to/file.ts' },
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
      };

      tracker.processEvent(event);
      const cost = tracker.getCost();

      expect(cost.inputTokens).toBeGreaterThan(0);
    });

    it('should track output tokens from PostToolUse', () => {
      const event: HudEvent = {
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'x'.repeat(400) },
        session: 'test',
        ts: Date.now() / 1000,
      };

      tracker.processEvent(event);
      const cost = tracker.getCost();

      expect(cost.outputTokens).toBeGreaterThan(0);
    });

    it('should track user prompt tokens', () => {
      const event: HudEvent = {
        event: 'UserPromptSubmit',
        tool: null,
        input: null,
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
        prompt: 'Hello, please help me with this task',
      };

      tracker.processEvent(event);
      const cost = tracker.getCost();

      expect(cost.inputTokens).toBeGreaterThan(0);
    });
  });

  describe('getCost', () => {
    it('should return zero cost initially', () => {
      const cost = tracker.getCost();

      expect(cost.inputCost).toBe(0);
      expect(cost.outputCost).toBe(0);
      expect(cost.totalCost).toBe(0);
    });

    it('should calculate cost based on token usage', () => {
      // Add ~10000 output tokens (40000 chars / 4)
      tracker.processEvent({
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'x'.repeat(40000) },
        session: 'test',
        ts: Date.now() / 1000,
      });

      const cost = tracker.getCost();

      // ~10000 tokens (JSON wrapper adds a few chars)
      expect(cost.outputTokens).toBeGreaterThan(9900);
      expect(cost.outputTokens).toBeLessThan(10100);
      // ~10000 tokens at $15/1M ≈ $0.15
      expect(cost.outputCost).toBeGreaterThan(0.14);
      expect(cost.outputCost).toBeLessThan(0.16);
    });
  });

  describe('setModel', () => {
    it('should set opus pricing', () => {
      tracker.setModel('claude-opus-4');

      tracker.processEvent({
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'x'.repeat(4000) },
        session: 'test',
        ts: Date.now() / 1000,
      });

      const cost = tracker.getCost();
      // ~1000 tokens at $75/1M ≈ $0.075
      expect(cost.outputCost).toBeGreaterThan(0.07);
      expect(cost.outputCost).toBeLessThan(0.08);
    });

    it('should set haiku pricing', () => {
      tracker.setModel('haiku');

      tracker.processEvent({
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'x'.repeat(4000) },
        session: 'test',
        ts: Date.now() / 1000,
      });

      const cost = tracker.getCost();
      // ~1000 tokens at $1.25/1M ≈ $0.00125
      expect(cost.outputCost).toBeGreaterThan(0.001);
      expect(cost.outputCost).toBeLessThan(0.002);
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      tracker.processEvent({
        event: 'PostToolUse',
        tool: 'Read',
        input: { test: true },
        response: { content: 'test' },
        session: 'test',
        ts: Date.now() / 1000,
      });

      tracker.reset();
      const cost = tracker.getCost();

      expect(cost.inputTokens).toBe(0);
      expect(cost.outputTokens).toBe(0);
      expect(cost.totalCost).toBe(0);
    });
  });

  describe('setPricing', () => {
    it('should apply custom pricing', () => {
      tracker.setPricing({
        sonnet: { input: 10.0, output: 50.0 },
        lastUpdated: '2025-01-01',
      });

      tracker.processEvent({
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'x'.repeat(4000) },
        session: 'test',
        ts: Date.now() / 1000,
      });

      const cost = tracker.getCost();
      expect(cost.outputCost).toBeGreaterThan(0.04);
      expect(cost.outputCost).toBeLessThan(0.06);
    });

    it('should indicate stale pricing', () => {
      tracker.setPricing({
        lastUpdated: '2024-01-01',
      });

      const cost = tracker.getCost();
      expect(cost.pricingStale).toBe(true);
    });

    it('should not indicate stale for recent pricing', () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);
      tracker.setPricing({
        lastUpdated: recentDate.toISOString().split('T')[0],
      });

      const cost = tracker.getCost();
      expect(cost.pricingStale).toBe(false);
    });
  });
});

describe('isPricingStale', () => {
  it('should return true for old dates', () => {
    expect(isPricingStale('2024-01-01')).toBe(true);
  });

  it('should return false for recent dates', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 30);
    expect(isPricingStale(recentDate.toISOString())).toBe(false);
  });
});

describe('mergePricing', () => {
  const base = {
    sonnet: { input: 3.0, output: 15.0 },
    opus: { input: 15.0, output: 75.0 },
    haiku: { input: 0.25, output: 1.25 },
    lastUpdated: '2025-01-01',
  };

  it('should return base when no override', () => {
    expect(mergePricing(base)).toBe(base);
    expect(mergePricing(base, undefined)).toBe(base);
  });

  it('should merge partial overrides', () => {
    const result = mergePricing(base, { sonnet: { input: 5.0, output: 25.0 } });
    expect(result.sonnet.input).toBe(5.0);
    expect(result.opus.input).toBe(15.0);
  });

  it('should merge lastUpdated override', () => {
    const result = mergePricing(base, { lastUpdated: '2025-06-01' });
    expect(result.lastUpdated).toBe('2025-06-01');
  });
});
