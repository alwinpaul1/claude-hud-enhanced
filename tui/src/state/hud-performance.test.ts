import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { describe, expect, it } from 'vitest';
import { HudStore } from './hud-store.js';
import type { EventSource } from './hud-store.js';
import { parseHudEvent } from '../lib/hud-event.js';

function createEventSource(): { source: EventSource; emitter: EventEmitter } {
  const emitter = new EventEmitter();
  const source: EventSource = {
    on(event, listener) {
      emitter.on(event, listener);
    },
    getStatus() {
      return 'connected';
    },
    close() {
      emitter.removeAllListeners();
    },
    switchFifo() {
      return;
    },
  };
  return { source, emitter };
}

describe('HudStore performance', () => {
  it('caps render notifications during high-volume events', async () => {
    const { source, emitter } = createEventSource();
    const store = new HudStore({
      fifoPath: '/tmp/test.fifo',
      clockIntervalMs: 0,
      emitIntervalMs: 50,
      eventSourceFactory: () => source,
    });

    const updates: number[] = [];
    const unsubscribe = store.subscribe(() => {
      updates.push(Date.now());
    });

    const fixturePath = resolve(__dirname, '../../test-fixtures/hud-events-stress.jsonl');
    const lines = readFileSync(fixturePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0);

    for (const line of lines) {
      const event = parseHudEvent(line);
      if (event) {
        emitter.emit('event', event);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(updates.length).toBeLessThanOrEqual(2);

    unsubscribe();
    store.dispose();
  });
});
