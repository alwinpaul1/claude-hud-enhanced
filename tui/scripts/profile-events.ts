import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { HudStore } from '../src/state/hud-store.js';
import type { EventSource } from '../src/state/hud-store.js';
import { parseHudEvent } from '../src/lib/hud-event.js';

function createEventSource() {
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
  return { emitter, source };
}

const inputPath = resolve(process.argv[2] || '');
if (!inputPath) {
  console.log('Usage: bun run profile:events -- path/to/events.jsonl');
  process.exit(1);
}

const lines = readFileSync(inputPath, 'utf-8')
  .split('\n')
  .filter((line) => line.trim().length > 0);

const { emitter, source } = createEventSource();
const store = new HudStore({
  fifoPath: 'profile',
  clockIntervalMs: 0,
  emitIntervalMs: 0,
  eventSourceFactory: () => source,
});

const start = Date.now();
let count = 0;
for (const line of lines) {
  const event = parseHudEvent(line);
  if (!event) continue;
  emitter.emit('event', event);
  count += 1;
}
const duration = Date.now() - start;
const state = store.getState();

console.log(
  `Processed ${count} events in ${duration}ms. tools=${state.tools.length} todos=${state.todos.length} agents=${state.agents.length}`,
);

store.dispose();
