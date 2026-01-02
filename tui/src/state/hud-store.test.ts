import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { HudStore } from './hud-store.js';
import type { HudEvent } from '../lib/types.js';
import type { EventSource } from './hud-store.js';

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

describe('HudStore', () => {
  async function flush(): Promise<void> {
    await Promise.resolve();
  }

  it('emits at most once per event (render budget)', () => {
    const { source, emitter } = createEventSource();
    const store = new HudStore({
      fifoPath: '/tmp/test.fifo',
      clockIntervalMs: 0,
      emitIntervalMs: 0,
      eventSourceFactory: () => source,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const event: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'README.md' },
      response: null,
      session: 's1',
      ts: 1,
    };

    emitter.emit('event', event);
    return flush().then(() => {
      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      store.dispose();
    });
  });

  it('applies an event stream to state', () => {
    const { source, emitter } = createEventSource();
    const store = new HudStore({
      fifoPath: '/tmp/test.fifo',
      clockIntervalMs: 0,
      emitIntervalMs: 0,
      eventSourceFactory: () => source,
    });

    const preEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: { file_path: 'README.md' },
      response: null,
      session: 's1',
      ts: 1,
    };
    const postEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PostToolUse',
      tool: 'Read',
      toolUseId: 'tool-1',
      input: null,
      response: { duration_ms: 200 },
      session: 's1',
      ts: 2,
    };
    const todoEvent: HudEvent = {
      schemaVersion: 1,
      event: 'PreToolUse',
      tool: 'TodoWrite',
      toolUseId: 'todo-1',
      input: { todos: [{ content: 'Ship HUD', status: 'in_progress' }] },
      response: null,
      session: 's1',
      ts: 3,
    };
    const stopEvent: HudEvent = {
      schemaVersion: 1,
      event: 'Stop',
      tool: null,
      input: null,
      response: null,
      session: 's1',
      ts: 4,
    };

    emitter.emit('event', preEvent);
    emitter.emit('event', postEvent);
    emitter.emit('event', todoEvent);
    emitter.emit('event', stopEvent);

    return flush().then(() => {
      const state = store.getState();
      expect(state.tools).toHaveLength(2);
      expect(state.tools[0]?.status).toBe('complete');
      expect(state.todos).toHaveLength(1);
      expect(state.sessionInfo.isIdle).toBe(true);

      store.dispose();
    });
  });
});
