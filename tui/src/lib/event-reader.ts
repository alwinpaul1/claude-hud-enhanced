import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import type { HudEvent } from './types.js';

export class EventReader extends EventEmitter {
  private stream: ReturnType<typeof createReadStream> | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private closed = false;

  constructor(private fifoPath: string) {
    super();
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;

    try {
      this.stream = createReadStream(this.fifoPath, { encoding: 'utf-8' });
      this.rl = createInterface({ input: this.stream });

      this.rl.on('line', (line: string) => {
        try {
          const event = JSON.parse(line) as HudEvent;
          this.emit('event', event);
        } catch {
          // Ignore malformed JSON
        }
      });

      this.stream.on('end', () => {
        if (!this.closed) {
          setTimeout(() => this.connect(), 100);
        }
      });

      this.stream.on('error', () => {
        if (!this.closed) {
          setTimeout(() => this.connect(), 1000);
        }
      });
    } catch {
      if (!this.closed) {
        setTimeout(() => this.connect(), 1000);
      }
    }
  }

  close(): void {
    this.closed = true;
    this.rl?.close();
    this.stream?.destroy();
  }
}
