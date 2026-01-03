import { execSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App } from './app.js';

const MKFIFO_COMMAND = 'mkfifo';

function canUseFifo(): boolean {
  if (process.platform === 'win32') return false;
  try {
    execSync('command -v mkfifo', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function waitForFrameContains(
  getFrame: () => string | undefined,
  text: string,
  timeoutMs = 1000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = getFrame() ?? '';
    if (frame.includes(text)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for frame to contain: ${text}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('HUD smoke test', () => {
  const testFn = canUseFifo() ? it : it.skip;
  let tempDir: string | null = null;

  afterEach(async () => {
    // Wait for any pending timers to clear before cleanup
    await sleep(100);
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      tempDir = null;
    }
  });

  testFn('renders and processes fifo events', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'claude-hud-'));
    const fifoPath = join(tempDir, 'events.fifo');
    execSync(`${MKFIFO_COMMAND} ${fifoPath}`);

    const { lastFrame, unmount } = render(<App sessionId="test-session" fifoPath={fifoPath} />);

    const writer = createWriteStream(fifoPath, { encoding: 'utf-8' });
    writer.write(
      `${JSON.stringify({
        schemaVersion: 1,
        event: 'UserPromptSubmit',
        session: 'test-session',
        prompt: 'Smoke test prompt',
        ts: Math.floor(Date.now() / 1000),
      })}\n`,
    );
    writer.end();

    await waitForFrameContains(lastFrame, 'Claude HUD');

    unmount();
    // Wait for EventReader cleanup timers to clear
    await sleep(50);
  });
});
