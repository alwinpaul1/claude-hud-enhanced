import { describe, it, expect } from 'vitest';
import type { HudEvent } from './types.js';

// Helper function to parse events as the event reader does
function parseEvent(line: string): HudEvent | null {
  try {
    const parsed = JSON.parse(line) as HudEvent;
    if (!parsed.event || !parsed.session) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

describe('Event Parser', () => {
  describe('parseEvent', () => {
    it('should parse valid PostToolUse event', () => {
      const line = JSON.stringify({
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/test.ts' },
        response: { content: 'file content' },
        session: 'test-session',
        ts: 1234567890,
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.event).toBe('PostToolUse');
      expect(result?.tool).toBe('Read');
    });

    it('should parse valid PreToolUse event', () => {
      const line = JSON.stringify({
        event: 'PreToolUse',
        tool: 'Write',
        toolUseId: 'tool-123',
        input: { file_path: '/test.ts', content: 'new content' },
        response: null,
        session: 'test-session',
        ts: 1234567890,
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.event).toBe('PreToolUse');
      expect(result?.toolUseId).toBe('tool-123');
    });

    it('should parse UserPromptSubmit event', () => {
      const line = JSON.stringify({
        event: 'UserPromptSubmit',
        tool: null,
        input: null,
        response: null,
        session: 'test-session',
        ts: 1234567890,
        prompt: 'Help me fix this bug',
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.event).toBe('UserPromptSubmit');
      expect(result?.prompt).toBe('Help me fix this bug');
    });

    it('should parse Stop event', () => {
      const line = JSON.stringify({
        event: 'Stop',
        tool: null,
        input: null,
        response: null,
        session: 'test-session',
        ts: 1234567890,
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.event).toBe('Stop');
    });

    it('should parse PreCompact event', () => {
      const line = JSON.stringify({
        event: 'PreCompact',
        tool: null,
        input: null,
        response: null,
        session: 'test-session',
        ts: 1234567890,
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.event).toBe('PreCompact');
    });

    it('should parse event with session info', () => {
      const line = JSON.stringify({
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/test.ts' },
        response: { content: 'test' },
        session: 'test-session',
        ts: 1234567890,
        permissionMode: 'plan',
        cwd: '/Users/test/project',
        transcriptPath: '/tmp/transcript.json',
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.permissionMode).toBe('plan');
      expect(result?.cwd).toBe('/Users/test/project');
    });

    it('should return null for malformed JSON', () => {
      const result = parseEvent('not valid json');
      expect(result).toBeNull();
    });

    it('should return null for empty line', () => {
      const result = parseEvent('');
      expect(result).toBeNull();
    });

    it('should return null for missing event field', () => {
      const line = JSON.stringify({
        tool: 'Read',
        session: 'test',
        ts: 123,
      });

      const result = parseEvent(line);
      expect(result).toBeNull();
    });

    it('should return null for missing session field', () => {
      const line = JSON.stringify({
        event: 'PostToolUse',
        tool: 'Read',
        ts: 123,
      });

      const result = parseEvent(line);
      expect(result).toBeNull();
    });

    it('should handle very long file paths', () => {
      const longPath = '/very/long/path/' + 'nested/'.repeat(50) + 'file.ts';
      const line = JSON.stringify({
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: longPath },
        response: { content: 'test' },
        session: 'test-session',
        ts: 1234567890,
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.input?.file_path).toBe(longPath);
    });

    it('should handle very long response content', () => {
      const longContent = 'x'.repeat(100000);
      const line = JSON.stringify({
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/test.ts' },
        response: { content: longContent },
        session: 'test-session',
        ts: 1234567890,
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.response?.content).toBe(longContent);
    });

    it('should handle unicode in content', () => {
      const line = JSON.stringify({
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/test.ts' },
        response: { content: '日本語 🎉 émoji' },
        session: 'test-session',
        ts: 1234567890,
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.response?.content).toBe('日本語 🎉 émoji');
    });

    it('should handle special characters in paths', () => {
      const line = JSON.stringify({
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/path with spaces/file (1).ts' },
        response: { content: 'test' },
        session: 'test-session',
        ts: 1234567890,
      });

      const result = parseEvent(line);

      expect(result).not.toBeNull();
      expect(result?.input?.file_path).toBe('/path with spaces/file (1).ts');
    });
  });
});
