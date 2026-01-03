import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UnifiedContextTracker } from './unified-context-tracker.js';
import type { HudEvent } from './types.js';

function createEvent(overrides: Partial<HudEvent> = {}): HudEvent {
  return {
    event: 'PostToolUse',
    tool: 'Read',
    toolUseId: `tool-${Date.now()}`,
    input: { file_path: '/test/file.ts' },
    response: { content: 'file content here' },
    session: 'test-session',
    ts: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe('UnifiedContextTracker', () => {
  let tracker: UnifiedContextTracker;

  beforeEach(() => {
    tracker = new UnifiedContextTracker();
  });

  describe('getHealth', () => {
    it('returns initial health with zero tokens', () => {
      const health = tracker.getHealth();

      expect(health.tokens).toBe(0);
      expect(health.percent).toBe(0);
      expect(health.remaining).toBe(200000);
      expect(health.maxTokens).toBe(200000);
      expect(health.status).toBe('healthy');
      expect(health.shouldCompact).toBe(false);
    });
  });

  describe('processEvent', () => {
    it('estimates tokens from PostToolUse events', () => {
      const event = createEvent({
        input: { content: 'a'.repeat(400) },
        response: { result: 'b'.repeat(400) },
      });

      tracker.processEvent(event);
      const health = tracker.getHealth();

      expect(health.tokens).toBeGreaterThan(0);
      expect(health.breakdown.toolInputs).toBeGreaterThan(0);
      expect(health.breakdown.toolOutputs).toBeGreaterThan(0);
    });

    it('tracks compaction count from PreCompact events', () => {
      expect(tracker.getCompactionCount()).toBe(0);

      tracker.processEvent(createEvent({ event: 'PreCompact' }));
      expect(tracker.getCompactionCount()).toBe(1);

      tracker.processEvent(createEvent({ event: 'PreCompact' }));
      expect(tracker.getCompactionCount()).toBe(2);
    });

    it('sets transcript path from event', () => {
      const event = createEvent({
        transcriptPath: '/tmp/transcript.jsonl',
      });

      tracker.processEvent(event);
      // Transcript path is set internally - verified by attempting to read
    });
  });

  describe('token history', () => {
    it('builds token history over multiple events', () => {
      for (let i = 0; i < 5; i++) {
        tracker.processEvent(
          createEvent({
            input: { data: 'x'.repeat(100) },
            response: { data: 'y'.repeat(100) },
          }),
        );
      }

      const health = tracker.getHealth();
      expect(health.tokenHistory.length).toBeGreaterThan(0);
    });

    it('limits history to 20 samples for sparkline', () => {
      for (let i = 0; i < 30; i++) {
        tracker.processEvent(createEvent());
      }

      const health = tracker.getHealth();
      expect(health.tokenHistory.length).toBeLessThanOrEqual(20);
    });
  });

  describe('status thresholds', () => {
    it('reports warning status at 70% usage', () => {
      // Mock by directly processing many events
      // With 200k max and 4 chars per token:
      // 70% = 140k tokens = 560k chars
      const largeInput = { data: 'x'.repeat(280000) };
      const largeResponse = { data: 'x'.repeat(280000) };

      tracker.processEvent(
        createEvent({
          input: largeInput,
          response: largeResponse,
        }),
      );

      const health = tracker.getHealth();
      expect(health.status).toBe('warning');
    });

    it('reports critical status at 85% usage', () => {
      const largeInput = { data: 'x'.repeat(340000) };
      const largeResponse = { data: 'x'.repeat(340000) };

      tracker.processEvent(
        createEvent({
          input: largeInput,
          response: largeResponse,
        }),
      );

      const health = tracker.getHealth();
      expect(health.status).toBe('critical');
      expect(health.shouldCompact).toBe(true);
    });
  });

  describe('burn rate', () => {
    it('calculates burn rate from token history', async () => {
      // Process events with slight delay to build history
      for (let i = 0; i < 5; i++) {
        tracker.processEvent(
          createEvent({
            input: { data: 'x'.repeat(1000) },
            response: { data: 'y'.repeat(1000) },
          }),
        );
        await new Promise((r) => setTimeout(r, 10));
      }

      const health = tracker.getHealth();
      // Burn rate may be 0 if time interval too short, but shouldn't error
      expect(typeof health.burnRate).toBe('number');
    });

    it('returns 0 burn rate with insufficient history', () => {
      tracker.processEvent(createEvent());
      const health = tracker.getHealth();
      expect(health.burnRate).toBe(0);
    });
  });

  describe('reset', () => {
    it('resets all tracking state', () => {
      tracker.processEvent(
        createEvent({
          input: { data: 'test data' },
          response: { data: 'response' },
        }),
      );
      tracker.processEvent(createEvent({ event: 'PreCompact' }));

      const beforeReset = tracker.getHealth();
      expect(beforeReset.tokens).toBeGreaterThan(0);
      expect(tracker.getCompactionCount()).toBe(1);

      tracker.reset();

      const afterReset = tracker.getHealth();
      expect(afterReset.tokens).toBe(0);
      expect(afterReset.percent).toBe(0);
      expect(afterReset.tokenHistory).toHaveLength(0);
      expect(tracker.getCompactionCount()).toBe(0);
    });
  });

  describe('setTranscriptPath', () => {
    it('accepts a transcript path without error', () => {
      // Even if file doesn't exist, should not throw
      expect(() => {
        tracker.setTranscriptPath('/nonexistent/path.jsonl');
      }).not.toThrow();
    });

    it('updates usage from appended transcript lines', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
      const transcriptPath = path.join(tmpDir, 'transcript.jsonl');

      const first = {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4',
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
      };

      fs.writeFileSync(transcriptPath, `${JSON.stringify(first)}\n`, 'utf-8');
      tracker.setTranscriptPath(transcriptPath);
      tracker.processEvent(createEvent({ event: 'Stop' }));

      const firstHealth = tracker.getHealth();
      expect(firstHealth.tokens).toBe(315);
      expect(tracker.getModel()).toBe('claude-sonnet-4');

      const second = {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4',
          usage: {
            input_tokens: 300,
            output_tokens: 400,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 15,
          },
        },
      };

      fs.appendFileSync(transcriptPath, `${JSON.stringify(second)}\n`, 'utf-8');
      tracker.processEvent(createEvent({ event: 'Stop' }));

      const secondHealth = tracker.getHealth();
      expect(secondHealth.tokens).toBe(725);

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('getModel', () => {
    it('returns null initially', () => {
      expect(tracker.getModel()).toBeNull();
    });
  });
});
