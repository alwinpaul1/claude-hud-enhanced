import type { ConnectionStatus } from '../lib/event-reader.js';
import type { SettingsData } from '../lib/settings-reader.js';
import type { ContextFiles } from '../lib/context-detector.js';
import type { HudConfig } from '../lib/hud-config.js';
import type {
  ToolEntry,
  TodoItem,
  ContextHealth,
  AgentEntry,
  SessionInfo,
  CostEstimate,
} from '../lib/types.js';

export interface HudState {
  tools: ToolEntry[];
  todos: TodoItem[];
  context: ContextHealth;
  agents: AgentEntry[];
  sessionInfo: SessionInfo;
  sessionPhase: 'connecting' | 'connected' | 'idle' | 'active' | 'disconnected' | 'error';
  settings: SettingsData | null;
  contextFiles: ContextFiles | null;
  connectionStatus: ConnectionStatus;
  cost: CostEstimate;
  model: string | null;
  config: HudConfig | null;
  now: number;
}

export interface HudStateInternal extends HudState {
  runningTools: Map<string, ToolEntry>;
}

export function createInitialHudState(options: {
  initialTranscriptPath?: string;
  context: ContextHealth;
  cost: CostEstimate;
}): HudStateInternal {
  return {
    tools: [],
    todos: [],
    context: options.context,
    agents: [],
    sessionInfo: {
      permissionMode: 'default',
      cwd: '',
      transcriptPath: options.initialTranscriptPath || '',
      isIdle: true,
    },
    sessionPhase: 'connecting',
    settings: null,
    contextFiles: null,
    connectionStatus: 'connecting',
    cost: options.cost,
    model: null,
    config: null,
    now: Date.now(),
    runningTools: new Map(),
  };
}

export function toPublicState(state: HudStateInternal): HudState {
  const { runningTools: _runningTools, ...publicState } = state;
  return publicState;
}
