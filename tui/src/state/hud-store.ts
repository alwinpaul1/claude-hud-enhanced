import { EventReader, ConnectionStatus } from '../lib/event-reader.js';
import { UnifiedContextTracker } from '../lib/unified-context-tracker.js';
import { CostTracker } from '../lib/cost-tracker.js';
import { SettingsReader } from '../lib/settings-reader.js';
import { ContextDetector } from '../lib/context-detector.js';
import { HudConfigReader } from '../lib/hud-config.js';
import type { HudEvent } from '../lib/types.js';
import { createInitialHudState, toPublicState } from './hud-state.js';
import type { HudState, HudStateInternal } from './hud-state.js';
import { reduceHudState } from './hud-reducer.js';

export interface EventSource {
  on(event: 'event', listener: (event: HudEvent) => void): void;
  on(event: 'status', listener: (status: ConnectionStatus) => void): void;
  getStatus(): ConnectionStatus;
  close(): void;
  switchFifo(fifoPath: string): void;
}

interface HudStoreOptions {
  fifoPath: string;
  initialTranscriptPath?: string;
  clockIntervalMs?: number;
  eventSourceFactory?: (fifoPath: string) => EventSource;
}

export class HudStore {
  private state: HudStateInternal;
  private publicState: HudState;
  private readonly listeners = new Set<() => void>();
  private readonly contextTracker = new UnifiedContextTracker();
  private readonly costTracker = new CostTracker();
  private readonly settingsReader = new SettingsReader();
  private readonly contextDetector = new ContextDetector();
  private readonly configReader = new HudConfigReader();
  private readonly reader: EventSource;
  private settingsInterval: ReturnType<typeof setInterval> | null = null;
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private lastCwd = '';
  private emitScheduled = false;

  constructor(options: HudStoreOptions) {
    if (options.initialTranscriptPath) {
      this.contextTracker.setTranscriptPath(options.initialTranscriptPath);
    }

    this.state = createInitialHudState({
      initialTranscriptPath: options.initialTranscriptPath,
      context: this.contextTracker.getHealth(),
      cost: this.costTracker.getCost(),
    });
    this.publicState = toPublicState(this.state);

    const eventSourceFactory =
      options.eventSourceFactory || ((fifoPath) => new EventReader(fifoPath));
    this.reader = eventSourceFactory(options.fifoPath);
    this.reader.on('event', this.handleEvent);
    this.reader.on('status', this.handleStatus);

    this.apply({ type: 'connection', status: this.reader.getStatus() });
    this.refreshEnvironment();
    this.settingsInterval = setInterval(() => this.refreshEnvironment(), 30000);

    const clockIntervalMs = options.clockIntervalMs ?? 1000;
    if (clockIntervalMs > 0) {
      this.clockInterval = setInterval(() => this.tick(), clockIntervalMs);
    }
  }

  getState(): HudState {
    return this.publicState;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.settingsInterval) {
      clearInterval(this.settingsInterval);
      this.settingsInterval = null;
    }
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    this.reader.close();
    this.listeners.clear();
  }

  switchFifo(fifoPath: string): void {
    this.reader.switchFifo(fifoPath);
  }

  private emit(): void {
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    Promise.resolve().then(() => {
      this.emitScheduled = false;
      for (const listener of this.listeners) {
        listener();
      }
    });
  }

  private apply(action: Parameters<typeof reduceHudState>[1]): void {
    this.state = reduceHudState(this.state, action);
    this.publicState = toPublicState(this.state);
  }

  private handleStatus = (status: ConnectionStatus): void => {
    this.apply({ type: 'connection', status });
    this.emit();
  };

  private handleEvent = (event: HudEvent): void => {
    const prevState = this.state;
    const now = Date.now();

    this.apply({ type: 'event', event, now });

    if (event.event === 'PostToolUse' || event.event === 'Stop' || event.event === 'PreCompact') {
      this.contextTracker.processEvent(event);
      this.apply({ type: 'context', context: this.contextTracker.getHealth() });
    }

    if (event.event === 'PostToolUse' || event.event === 'UserPromptSubmit') {
      this.costTracker.processEvent(event);
      this.apply({ type: 'cost', cost: this.costTracker.getCost() });
    }

    if (event.event === 'Stop') {
      const detectedModel = this.contextTracker.getModel();
      if (detectedModel) {
        this.apply({ type: 'model', model: detectedModel });
        this.costTracker.setModel(detectedModel);
      }
    }

    if (prevState.sessionInfo.transcriptPath !== this.state.sessionInfo.transcriptPath) {
      const transcriptPath = this.state.sessionInfo.transcriptPath;
      if (transcriptPath) {
        this.contextTracker.setTranscriptPath(transcriptPath);
        this.apply({ type: 'context', context: this.contextTracker.getHealth() });
      }
    }

    if (prevState.sessionInfo.cwd !== this.state.sessionInfo.cwd) {
      this.lastCwd = this.state.sessionInfo.cwd;
      const contextFiles = this.contextDetector.forceRefresh(this.lastCwd || undefined);
      this.apply({ type: 'contextFiles', contextFiles });
    }

    this.emit();
  };

  private refreshEnvironment(): void {
    this.apply({ type: 'settings', settings: this.settingsReader.read() });
    const contextFiles = this.contextDetector.detect(this.lastCwd || undefined);
    this.apply({ type: 'contextFiles', contextFiles });
    this.apply({ type: 'config', config: this.configReader.read() });
    this.emit();
  }

  private tick(): void {
    this.apply({ type: 'tick', now: Date.now() });
    this.emit();
  }
}
