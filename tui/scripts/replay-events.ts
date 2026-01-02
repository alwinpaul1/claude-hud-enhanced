import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { HudStore } from '../src/state/hud-store.js';
import type { EventSource } from '../src/state/hud-store.js';
import { parseHudEvent } from '../src/lib/hud-event.js';

type Args = {
  input?: string;
  json?: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') {
      args.input = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      args.json = true;
    }
  }
  return args;
}

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

function usage(): void {
  console.log('Usage: bun run replay:events -- --input path/to/events.jsonl [--json]');
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  usage();
  process.exit(1);
}

const inputPath = resolve(args.input);
const contents = readFileSync(inputPath, 'utf-8');
const lines = contents.split('\n').filter((line) => line.trim().length > 0);

const { emitter, source } = createEventSource();
const store = new HudStore({
  fifoPath: 'replay',
  clockIntervalMs: 0,
  eventSourceFactory: () => source,
});

lines.forEach((line, index) => {
  const event = parseHudEvent(line);
  if (!event) {
    console.warn(`Skipping invalid event line ${index + 1}`);
    return;
  }
  emitter.emit('event', event);
  const state = store.getState();
  if (args.json) {
    console.log(
      JSON.stringify(
        {
          index: index + 1,
          event: event.event,
          tools: state.tools.length,
          todos: state.todos.length,
          agents: state.agents.length,
          cost: state.cost.totalCost,
          contextPercent: state.context.percent,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `#${index + 1} ${event.event} tools=${state.tools.length} todos=${state.todos.length} agents=${state.agents.length} cost=$${state.cost.totalCost.toFixed(
        2,
      )}`,
    );
  }
});

store.dispose();
