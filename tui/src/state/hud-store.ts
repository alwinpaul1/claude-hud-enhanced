import { EventReader, ConnectionStatus } from '../lib/event-reader.js';
import { UnifiedContextTracker } from '../lib/unified-context-tracker.js';
import { CostTracker } from '../lib/cost-tracker.js';
import { SettingsReader } from '../lib/settings-reader.js';
import { ContextDetector } from '../lib/context-detector.js';
import { HudConfigReader } from '../lib/hud-config.js';
import type { HudEvent } from '../lib/types.js';
import type { HudEventParseError } from '../lib/hud-event.js';
import { createInitialHudState, toPublicState } from './hud-state.js';
import type { HudState, HudStateInternal } from './hud-state.js';
import { reduceHudState } from './hud-reducer.js';
import type { HudError } from './hud-errors.js';
import { logger } from '../lib/logger.js';

export interface EventSource {
  on(event: 'event', listener: (event: HudEvent) => void): void;
  on(event: 'status', listener: (status: ConnectionStatus) => void): void;
  on(event: 'parseError', listener: (error: HudEventParseError) => void): void;
  getStatus(): ConnectionStatus;
  close(): void;
  switchFifo(fifoPath: string): void;
}

interface HudStoreOptions {
  fifoPath: string;
  initialSessionId?: string;
  initialTranscriptPath?: string;
  clockIntervalMs?: number;
  emitIntervalMs?: number;
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
  private emitTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastEmitAt = 0;
  private readonly emitIntervalMs: number;
  private settingsError: string | null = null;
  private configError: string | null = null;
  private refreshing = false;

  constructor(options: HudStoreOptions) {
    if (options.initialTranscriptPath) {
      this.contextTracker.setTranscriptPath(options.initialTranscriptPath);
    }

    this.state = createInitialHudState({
      initialSessionId: options.initialSessionId,
      initialTranscriptPath: options.initialTranscriptPath,
      context: this.contextTracker.getHealth(),
      cost: this.costTracker.getCost(),
    });
    this.publicState = toPublicState(this.state);

    const eventSourceFactory =
      options.eventSourceFactory || ((fifoPath) => new EventReader(fifoPath));
    this.reader = eventSourceFactory(options.fifoPath);
    this.emitIntervalMs = options.emitIntervalMs ?? 16;
    this.reader.on('event', this.handleEvent);
    this.reader.on('status', this.handleStatus);
    this.reader.on('parseError', this.handleParseError);

    this.apply({ type: 'connection', status: this.reader.getStatus() });
    void this.refreshEnvironment();
    this.settingsInterval = setInterval(() => {
      void this.refreshEnvironment();
    }, 30000);

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
    if (this.emitTimeout) {
      clearTimeout(this.emitTimeout);
      this.emitTimeout = null;
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
    const now = Date.now();
    const elapsed = now - this.lastEmitAt;
    const delay = Math.max(0, this.emitIntervalMs - elapsed);
    const flush = () => {
      this.emitScheduled = false;
      this.lastEmitAt = Date.now();
      for (const listener of this.listeners) {
        listener();
      }
    };

    if (delay === 0) {
      Promise.resolve().then(flush);
    } else if (!this.emitTimeout) {
      this.emitTimeout = setTimeout(() => {
        this.emitTimeout = null;
        flush();
      }, delay);
    }
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

  private handleParseError = (error: HudEventParseError): void => {
    this.recordError({
      code: error.code,
      message: error.message,
      ts: Date.now(),
      context: error.context,
    });
    this.emit();
  };

  private async refreshEnvironment(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const [settingsResult, configResult] = await Promise.all([
        this.settingsReader.readWithStatusAsync(),
        this.configReader.readWithStatusAsync(),
      ]);
      if (settingsResult.error) {
        logger.warn('HudStore', 'Settings read failed', { error: settingsResult.error });
        this.recordError({
          code: 'settings_read_failed',
          message: settingsResult.error,
          ts: Date.now(),
        });
        this.settingsError = settingsResult.error;
      } else {
        this.settingsError = null;
        this.apply({ type: 'settings', settings: settingsResult.data });
      }

      if (configResult.error) {
        logger.warn('HudStore', 'Config read failed', { error: configResult.error });
        this.recordError({
          code: 'config_read_failed',
          message: configResult.error,
          ts: Date.now(),
        });
        this.configError = configResult.error;
      } else {
        this.configError = null;
        this.apply({ type: 'config', config: configResult.data });
      }

      const contextFiles = this.contextDetector.detect(this.lastCwd || undefined);
      this.apply({ type: 'contextFiles', contextFiles });

      this.updateSafeMode();
      this.emit();
    } catch (err) {
      logger.warn('HudStore', 'Environment refresh failed', { err });
    } finally {
      this.refreshing = false;
    }
  }

  private tick(): void {
    this.apply({ type: 'tick', now: Date.now() });
    this.emit();
  }

  private recordError(error: HudError): void {
    this.apply({ type: 'error', error });
  }

  private updateSafeMode(): void {
    const safeMode = Boolean(this.settingsError || this.configError);
    const reason = this.settingsError
      ? 'Settings read failed; using last known good values.'
      : this.configError
        ? 'Config read failed; using last known good values.'
        : null;
    this.apply({ type: 'safeMode', safeMode, reason });
  }
}
