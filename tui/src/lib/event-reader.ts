import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import type { HudEvent } from './types.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export class EventReader extends EventEmitter {
  private stream: ReturnType<typeof createReadStream> | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private closed = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 50;
  private status: ConnectionStatus = 'connecting';
  private lastEventTime: number = 0;

  constructor(private fifoPath: string) {
    super();
    this.connect();
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getLastEventTime(): number {
    return this.lastEventTime;
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
    }
  }

  private connect(): void {
    if (this.closed) return;

    if (!existsSync(this.fifoPath)) {
      this.setStatus('connecting');
      setTimeout(() => this.connect(), 500);
      return;
    }

    try {
      // Use 'r+' (O_RDWR) flag - this doesn't block on FIFOs unlike 'r' (O_RDONLY)
      // because the process itself counts as a potential writer
      this.stream = createReadStream(this.fifoPath, { encoding: 'utf-8', flags: 'r+' });
      this.rl = createInterface({ input: this.stream });

      this.stream.once('open', () => {
        this.setStatus('connected');
        this.reconnectAttempts = 0;
      });

      this.rl.on('line', (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as HudEvent;
          this.lastEventTime = Date.now();
          this.emit('event', event);
        } catch {
          // Ignore malformed JSON silently
        }
      });

      this.stream.on('end', () => {
        this.cleanup();
        if (!this.closed) {
          this.setStatus('disconnected');
          this.scheduleReconnect();
        }
      });

      this.stream.on('error', () => {
        this.cleanup();
        if (!this.closed) {
          this.setStatus('error');
          this.scheduleReconnect();
        }
      });
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('error');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(100 * Math.pow(1.5, this.reconnectAttempts), 5000);
    setTimeout(() => this.connect(), delay);
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.stream?.destroy();
    this.stream = null;
  }

  close(): void {
    this.closed = true;
    this.cleanup();
    this.setStatus('disconnected');
  }

  switchFifo(newFifoPath: string): void {
    this.cleanup();
    this.fifoPath = newFifoPath;
    this.reconnectAttempts = 0;
    this.closed = false;
    this.setStatus('connecting');
    this.connect();
  }
}
