import { describe, it, expect, beforeEach } from 'vitest';
import { ContextTracker } from './context-tracker.js';
import type { HudEvent } from './types.js';

describe('ContextTracker', () => {
  let tracker: ContextTracker;

  beforeEach(() => {
    tracker = new ContextTracker();
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(tracker.estimateTokens('')).toBe(0);
    });

    it('should estimate ~4 chars per token', () => {
      const text = 'a'.repeat(100);
      expect(tracker.estimateTokens(text)).toBe(25);
    });

    it('should round up token estimates', () => {
      const text = 'a'.repeat(7);
      expect(tracker.estimateTokens(text)).toBe(2);
    });
  });

  describe('processEvent', () => {
    it('should track input tokens', () => {
      const event: HudEvent = {
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/path/to/file.ts' },
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
      };

      tracker.processEvent(event);
      const health = tracker.getHealth();

      expect(health.breakdown.toolInputs).toBeGreaterThan(0);
    });

    it('should track output tokens', () => {
      const event: HudEvent = {
        event: 'PostToolUse',
        tool: 'Read',
        input: null,
        response: { content: 'x'.repeat(400) },
        session: 'test',
        ts: Date.now() / 1000,
      };

      tracker.processEvent(event);
      const health = tracker.getHealth();

      expect(health.breakdown.toolOutputs).toBeGreaterThan(0);
    });
  });

  describe('getHealth', () => {
    it('should return initial healthy state', () => {
      const health = tracker.getHealth();

      expect(health.tokens).toBe(0);
      expect(health.percent).toBe(0);
      expect(health.status).toBe('healthy');
      expect(health.shouldCompact).toBe(false);
    });

    it('should calculate percent correctly', () => {
      for (let i = 0; i < 100; i++) {
        tracker.processEvent({
          event: 'PostToolUse',
          tool: 'Read',
          input: null,
          response: { content: 'x'.repeat(8000) },
          session: 'test',
          ts: Date.now() / 1000,
        });
      }

      const health = tracker.getHealth();
      expect(health.percent).toBeGreaterThan(0);
      expect(health.percent).toBeLessThanOrEqual(100);
    });

    it('should set warning status at 70%', () => {
      // Add tokens to get to ~75% (150k out of 200k = 75%)
      // Each response is ~2500 tokens (10000 chars / 4)
      for (let i = 0; i < 60; i++) {
        tracker.processEvent({
          event: 'PostToolUse',
          tool: 'Read',
          input: null,
          response: { content: 'x'.repeat(10000) },
          session: 'test',
          ts: Date.now() / 1000,
        });
      }

      const health = tracker.getHealth();
      expect(health.status).toBe('warning');
      expect(health.percent).toBeGreaterThanOrEqual(70);
      expect(health.percent).toBeLessThan(85);
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
      const health = tracker.getHealth();

      expect(health.tokens).toBe(0);
      expect(health.breakdown.toolInputs).toBe(0);
      expect(health.breakdown.toolOutputs).toBe(0);
    });
  });
});
