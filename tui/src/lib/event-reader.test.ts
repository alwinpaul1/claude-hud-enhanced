import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventReader } from './event-reader.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('EventReader', () => {
  it('emits events for valid JSON lines and ignores invalid ones', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath = path.join(tmpDir, 'events.log');
    const lines = [
      JSON.stringify({
        event: 'PostToolUse',
        tool: 'Read',
        input: { file_path: '/tmp/test.txt' },
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
      }),
      'not json',
      JSON.stringify({
        event: 'UserPromptSubmit',
        tool: null,
        input: null,
        response: null,
        session: 'test',
        ts: Date.now() / 1000,
        prompt: 'hello',
      }),
    ];
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');

    const reader = new EventReader(filePath);
    const events: Array<{ event: string }> = [];
    reader.on('event', (event) => events.push(event));

    await wait(50);
    reader.close();

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('PostToolUse');
    expect(events[1].event).toBe('UserPromptSubmit');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits status changes for connect and disconnect', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const filePath = path.join(tmpDir, 'events.log');
    fs.writeFileSync(filePath, '{}\n', 'utf-8');

    const reader = new EventReader(filePath);
    const statuses: string[] = [];
    reader.on('status', (status) => statuses.push(status));

    await wait(50);
    reader.close();

    expect(statuses).toContain('connected');
    expect(statuses).toContain('disconnected');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
