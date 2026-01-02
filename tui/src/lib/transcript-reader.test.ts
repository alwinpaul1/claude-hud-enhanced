import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TranscriptReader } from './transcript-reader.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function writeTranscript(filePath: string, lines: string[]): void {
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

describe('TranscriptReader', () => {
  let tmpDir: string;
  let filePath: string;
  let reader: TranscriptReader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    filePath = path.join(tmpDir, 'transcript.jsonl');
    reader = new TranscriptReader();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('aggregates token usage and model info', () => {
    writeTranscript(filePath, [
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 5,
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_creation_input_tokens: 7,
            cache_read_input_tokens: 2,
          },
        },
      }),
      JSON.stringify({ type: 'user', message: {} }),
      '{this is not valid json',
    ]);

    const tokens = reader.read(filePath);

    expect(tokens).not.toBeNull();
    expect(tokens?.inputTokens).toBe(10);
    expect(tokens?.outputTokens).toBe(5);
    expect(tokens?.cacheCreationTokens).toBe(7);
    expect(tokens?.cacheReadTokens).toBe(2);
    expect(tokens?.totalTokens).toBe(24);
    expect(tokens?.messageCount).toBe(2);
    expect(tokens?.model).toBe('claude-sonnet-4');
  });

  it('returns cached data when the file is unchanged', () => {
    writeTranscript(filePath, [
      JSON.stringify({
        type: 'assistant',
        message: { usage: { input_tokens: 1, output_tokens: 1 } },
      }),
    ]);

    const first = reader.read(filePath);
    const second = reader.read(filePath);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('computes context health thresholds', () => {
    writeTranscript(filePath, [
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-haiku-3-5',
          usage: { input_tokens: 170000, output_tokens: 0 },
        },
      }),
    ]);

    const health = reader.getContextHealth(filePath);

    expect(health).not.toBeNull();
    expect(health?.percent).toBe(85);
    expect(health?.status).toBe('critical');
    expect(health?.shouldCompact).toBe(true);
    expect(health?.remaining).toBe(30000);
  });
});
