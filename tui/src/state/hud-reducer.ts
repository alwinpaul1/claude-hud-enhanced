import type { HudEvent, ToolEntry, TodoItem, AgentEntry } from '../lib/types.js';
import type { ContextHealth, CostEstimate } from '../lib/types.js';
import type { SettingsData } from '../lib/settings-reader.js';
import type { ContextFiles } from '../lib/context-detector.js';
import type { ConnectionStatus } from '../lib/event-reader.js';
import type { HudConfig } from '../lib/hud-config.js';
import type { HudStateInternal } from './hud-state.js';
import type { HudError } from './hud-errors.js';

type HudAction =
  | { type: 'event'; event: HudEvent; now: number }
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'settings'; settings: SettingsData | null }
  | { type: 'contextFiles'; contextFiles: ContextFiles | null }
  | { type: 'config'; config: HudConfig | null }
  | { type: 'context'; context: ContextHealth }
  | { type: 'cost'; cost: CostEstimate }
  | { type: 'model'; model: string | null }
  | { type: 'tick'; now: number }
  | { type: 'error'; error: HudError }
  | { type: 'safeMode'; safeMode: boolean; reason: string | null };

function updateSessionInfo(state: HudStateInternal, event: HudEvent): HudStateInternal {
  if (
    event.session !== state.sessionInfo.sessionId ||
    event.permissionMode ||
    event.cwd ||
    event.transcriptPath
  ) {
    return {
      ...state,
      sessionInfo: {
        ...state.sessionInfo,
        sessionId: event.session || state.sessionInfo.sessionId,
        permissionMode: event.permissionMode || state.sessionInfo.permissionMode,
        cwd: event.cwd || state.sessionInfo.cwd,
        transcriptPath: event.transcriptPath || state.sessionInfo.transcriptPath,
      },
    };
  }
  return state;
}

function deriveSessionPhase(
  connectionStatus: ConnectionStatus,
  isIdle: boolean,
): HudStateInternal['sessionPhase'] {
  if (connectionStatus === 'connecting') return 'connecting';
  if (connectionStatus === 'disconnected') return 'disconnected';
  if (connectionStatus === 'error') return 'error';
  if (connectionStatus === 'connected') {
    return isIdle ? 'idle' : 'active';
  }
  return 'connected';
}

function withSessionPhase(state: HudStateInternal): HudStateInternal {
  return {
    ...state,
    sessionPhase: deriveSessionPhase(state.connectionStatus, state.sessionInfo.isIdle),
  };
}

function deriveToolTarget(event: HudEvent): string {
  const input = event.input as {
    file_path?: string;
    command?: string;
    pattern?: string;
  } | null;

  if (input?.file_path) return input.file_path;
  if (input?.command) return input.command.slice(0, 40);
  if (input?.pattern) return input.pattern.slice(0, 30);
  return '';
}

function addTool(state: HudStateInternal, entry: ToolEntry): HudStateInternal {
  return {
    ...state,
    tools: [...state.tools.slice(-29), entry],
  };
}

function updateRunningAgentTool(state: HudStateInternal, entry: ToolEntry): HudStateInternal {
  const runningIdx = state.agents.findIndex((agent) => agent.status === 'running');
  if (runningIdx === -1) return state;

  const updated = [...state.agents];
  const running = updated[runningIdx];
  updated[runningIdx] = {
    ...running,
    tools: [...running.tools.slice(-5), entry],
  };
  return { ...state, agents: updated };
}

function addAgent(state: HudStateInternal, event: HudEvent, now: number): HudStateInternal {
  const input = event.input as { subagent_type?: string; description?: string };
  const agent: AgentEntry = {
    id: event.toolUseId || `${event.ts}-${input?.subagent_type || 'unknown'}`,
    type: input?.subagent_type || 'Task',
    description: input?.description || '',
    status: 'running',
    startTs: now,
    tools: [],
  };
  return {
    ...state,
    agents: [...state.agents.slice(-10), agent],
  };
}

function completeRunningAgent(state: HudStateInternal, now: number): HudStateInternal {
  const runningIdx = state.agents.findIndex((agent) => agent.status === 'running');
  if (runningIdx === -1) return state;
  const updated = [...state.agents];
  updated[runningIdx] = {
    ...updated[runningIdx],
    status: 'complete',
    endTs: now,
  };
  return { ...state, agents: updated };
}

export function reduceHudState(state: HudStateInternal, action: HudAction): HudStateInternal {
  switch (action.type) {
    case 'connection':
      return withSessionPhase({ ...state, connectionStatus: action.status });
    case 'settings':
      return withSessionPhase({ ...state, settings: action.settings });
    case 'contextFiles':
      return withSessionPhase({ ...state, contextFiles: action.contextFiles });
    case 'config':
      return withSessionPhase({ ...state, config: action.config });
    case 'context':
      return withSessionPhase({ ...state, context: action.context });
    case 'cost':
      return withSessionPhase({ ...state, cost: action.cost });
    case 'model':
      return withSessionPhase({ ...state, model: action.model });
    case 'tick':
      return withSessionPhase({ ...state, now: action.now });
    case 'error': {
      const errors = [...state.errors, action.error].slice(-5);
      return withSessionPhase({ ...state, errors });
    }
    case 'safeMode':
      return withSessionPhase({
        ...state,
        safeMode: action.safeMode,
        safeModeReason: action.reason,
      });
    case 'event': {
      const { event, now } = action;
      let next = updateSessionInfo(state, event);

      if (event.event === 'PreToolUse' && event.tool && event.toolUseId) {
        const entry: ToolEntry = {
          id: event.toolUseId,
          tool: event.tool,
          target: deriveToolTarget(event),
          status: 'running',
          ts: event.ts,
          startTs: now,
        };

        const runningTools = new Map(next.runningTools);
        runningTools.set(event.toolUseId, entry);

        next = {
          ...addTool(next, entry),
          runningTools,
          sessionInfo: { ...next.sessionInfo, isIdle: false },
        };
      }

      if (event.event === 'PostToolUse' && event.tool) {
        const response = event.response as { error?: string; duration_ms?: number } | null;
        const hasError = response?.error !== undefined;
        const toolUseId = event.toolUseId || `${event.ts}-${event.tool}`;
        const existing = next.runningTools.get(toolUseId);
        const startTs = existing?.startTs || event.ts * 1000;

        const entry: ToolEntry = {
          id: toolUseId,
          tool: event.tool ?? '',
          target: existing?.target || '',
          status: hasError ? 'error' : 'complete',
          ts: event.ts,
          startTs,
          endTs: now,
          duration: response?.duration_ms || now - startTs,
        };

        const updatedTools = (() => {
          const idx = next.tools.findIndex((tool) => tool.id === toolUseId);
          if (idx === -1) return [...next.tools.slice(-29), entry];
          const copy = [...next.tools];
          copy[idx] = entry;
          return copy;
        })();

        const runningTools = new Map(next.runningTools);
        runningTools.delete(toolUseId);

        next = {
          ...next,
          tools: updatedTools,
          runningTools,
        };

        if (event.tool !== 'Task') {
          next = updateRunningAgentTool(next, entry);
        }
      }

      if (event.event === 'UserPromptSubmit') {
        next = {
          ...next,
          sessionInfo: { ...next.sessionInfo, isIdle: false },
        };
      }

      if (event.event === 'Stop') {
        next = {
          ...next,
          sessionInfo: { ...next.sessionInfo, isIdle: true },
        };
      }

      if (event.tool === 'TodoWrite' && event.input) {
        const todoInput = event.input as { todos?: TodoItem[] };
        if (todoInput.todos) {
          next = { ...next, todos: todoInput.todos };
        }
      }

      if (event.tool === 'Task' && event.input && event.event === 'PreToolUse') {
        next = addAgent(next, event, now);
      }

      if (event.event === 'SubagentStop') {
        next = completeRunningAgent(next, now);
      }

      return withSessionPhase(next);
    }
  }
}

export type { HudAction };
