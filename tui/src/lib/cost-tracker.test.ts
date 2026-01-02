import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker } from './cost-tracker.js';
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
});
