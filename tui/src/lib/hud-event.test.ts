import { describe, expect, it } from 'vitest';
import { parseHudEvent } from './hud-event.js';

describe('parseHudEvent', () => {
  it('parses a valid HUD event', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'README.md' },
      response: null,
      session: 's1',
      ts: 123,
      cwd: '/Users/jarrod/claude-hud',
    });
    const event = parseHudEvent(line);
    expect(event).not.toBeNull();
    expect(event?.event).toBe('PreToolUse');
    expect(event?.toolUseId).toBe('tool-1');
    expect(event?.cwd).toBe('/Users/jarrod/claude-hud');
  });

  it('accepts events without tool or input fields', () => {
    const line = JSON.stringify({
      schemaVersion: 1,
      event: 'UserPromptSubmit',
      session: 's1',
      ts: 999,
      prompt: 'Hello',
    });
    const event = parseHudEvent(line);
    expect(event).not.toBeNull();
    expect(event?.tool).toBeNull();
    expect(event?.input).toBeNull();
    expect(event?.prompt).toBe('Hello');
  });

  it('rejects invalid JSON or missing fields', () => {
    expect(parseHudEvent('not-json')).toBeNull();
    expect(parseHudEvent(JSON.stringify({ event: 'Stop' }))).toBeNull();
    expect(
      parseHudEvent(
        JSON.stringify({
          schemaVersion: 0,
          event: 'Stop',
          tool: null,
          input: null,
          response: null,
          session: 's1',
          ts: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseHudEvent(
        JSON.stringify({
          event: 'Stop',
          tool: null,
          input: null,
          response: null,
          session: 's1',
          ts: 'bad',
        }),
      ),
    ).toBeNull();
  });

  it('rejects missing schemaVersion', () => {
    const line = JSON.stringify({
      event: 'Stop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 1,
    });
    expect(parseHudEvent(line)).toBeNull();
  });
});
