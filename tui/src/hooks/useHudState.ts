import { useState, useEffect, useCallback, useRef } from 'react';
import { EventReader, ConnectionStatus } from '../lib/event-reader.js';
import { UnifiedContextTracker } from '../lib/unified-context-tracker.js';
import { SettingsReader, SettingsData } from '../lib/settings-reader.js';
import { ContextDetector, ContextFiles } from '../lib/context-detector.js';
import { CostTracker } from '../lib/cost-tracker.js';
import type {
  HudEvent,
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
  settings: SettingsData | null;
  contextFiles: ContextFiles | null;
  connectionStatus: ConnectionStatus;
  cost: CostEstimate;
  model: string | null;
}

interface UseHudStateOptions {
  fifoPath: string;
  initialTranscriptPath?: string;
}

export function useHudState({ fifoPath, initialTranscriptPath }: UseHudStateOptions): HudState {
  const contextTrackerRef = useRef(new UnifiedContextTracker());
  const costTrackerRef = useRef(new CostTracker());
  const settingsReaderRef = useRef(new SettingsReader());
  const contextDetectorRef = useRef(new ContextDetector());
  const runningToolsRef = useRef<Map<string, ToolEntry>>(new Map());

  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [context, setContext] = useState<ContextHealth>(contextTrackerRef.current.getHealth());
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [contextFiles, setContextFiles] = useState<ContextFiles | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [cost, setCost] = useState<CostEstimate>(costTrackerRef.current.getCost());
  const [model, setModel] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({
    permissionMode: 'default',
    cwd: '',
    transcriptPath: initialTranscriptPath || '',
    isIdle: true,
  });

  const processEvent = useCallback((event: HudEvent) => {
    if (event.permissionMode || event.cwd || event.transcriptPath) {
      setSessionInfo((prev) => ({
        ...prev,
        permissionMode: event.permissionMode || prev.permissionMode,
        cwd: event.cwd || prev.cwd,
        transcriptPath: event.transcriptPath || prev.transcriptPath,
      }));
    }

    if (event.event === 'PreToolUse' && event.tool && event.toolUseId) {
      const input = event.input as {
        file_path?: string;
        command?: string;
        pattern?: string;
      } | null;

      let target = '';
      if (input?.file_path) {
        target = input.file_path;
      } else if (input?.command) {
        target = input.command.slice(0, 40);
      } else if (input?.pattern) {
        target = input.pattern.slice(0, 30);
      }

      const entry: ToolEntry = {
        id: event.toolUseId,
        tool: event.tool,
        target,
        status: 'running',
        ts: event.ts,
        startTs: Date.now(),
      };

      runningToolsRef.current.set(event.toolUseId, entry);
      setTools((prev) => [...prev.slice(-29), entry]);
      setSessionInfo((prev) => ({ ...prev, isIdle: false }));
    }

    if (event.event === 'PostToolUse' && event.tool) {
      const response = event.response as { error?: string; duration_ms?: number } | null;
      const hasError = response?.error !== undefined;
      const now = Date.now();
      const toolUseId = event.toolUseId || `${event.ts}-${event.tool}`;
      const existingTool = runningToolsRef.current.get(toolUseId);
      const startTs = existingTool?.startTs || event.ts * 1000;

      const entry: ToolEntry = {
        id: toolUseId,
        tool: event.tool ?? '',
        target: existingTool?.target || '',
        status: hasError ? 'error' : 'complete',
        ts: event.ts,
        startTs,
        endTs: now,
        duration: response?.duration_ms || now - startTs,
      };

      setTools((prev) => {
        const idx = prev.findIndex((t) => t.id === toolUseId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = entry;
          return updated;
        }
        return [...prev.slice(-29), entry];
      });

      // Track tool calls for running agents (not Task tool itself)
      if (event.tool !== 'Task') {
        setAgents((prev) => {
          const runningIdx = prev.findIndex((a) => a.status === 'running');
          if (runningIdx !== -1) {
            const updated = [...prev];
            updated[runningIdx] = {
              ...updated[runningIdx],
              tools: [...updated[runningIdx].tools.slice(-5), entry],
            };
            return updated;
          }
          return prev;
        });
      }

      runningToolsRef.current.delete(toolUseId);
      contextTrackerRef.current.processEvent(event);
      costTrackerRef.current.processEvent(event);
      setContext(contextTrackerRef.current.getHealth());
      setCost(costTrackerRef.current.getCost());
    }

    if (event.event === 'UserPromptSubmit') {
      setSessionInfo((prev) => ({ ...prev, isIdle: false }));
      costTrackerRef.current.processEvent(event);
      setCost(costTrackerRef.current.getCost());
    }

    if (event.event === 'Stop') {
      setSessionInfo((prev) => ({ ...prev, isIdle: true }));
      contextTrackerRef.current.processEvent(event);
      setContext(contextTrackerRef.current.getHealth());
      const detectedModel = contextTrackerRef.current.getModel();
      if (detectedModel) {
        setModel(detectedModel);
        costTrackerRef.current.setModel(detectedModel);
      }
    }

    if (event.event === 'PreCompact') {
      contextTrackerRef.current.processEvent(event);
    }

    if (event.tool === 'TodoWrite' && event.input) {
      const todoInput = event.input as { todos?: TodoItem[] };
      if (todoInput.todos) {
        setTodos(todoInput.todos);
      }
    }

    if (event.tool === 'Task' && event.input && event.event === 'PreToolUse') {
      const taskInput = event.input as { subagent_type?: string; description?: string };
      const agentEntry: AgentEntry = {
        id: event.toolUseId || `${event.ts}-${taskInput.subagent_type || 'unknown'}`,
        type: taskInput.subagent_type || 'Task',
        description: taskInput.description || '',
        status: 'running',
        startTs: Date.now(),
        tools: [],
      };
      setAgents((prev) => [...prev.slice(-10), agentEntry]);
    }

    if (event.event === 'SubagentStop') {
      setAgents((prev) => {
        const updated = [...prev];
        const runningIdx = updated.findIndex((a) => a.status === 'running');
        if (runningIdx !== -1) {
          updated[runningIdx] = {
            ...updated[runningIdx],
            status: 'complete',
            endTs: Date.now(),
          };
        }
        return updated;
      });
    }
  }, []);

  useEffect(() => {
    const reader = new EventReader(fifoPath);
    reader.on('event', processEvent);
    reader.on('status', (status: ConnectionStatus) => {
      setConnectionStatus(status);
    });
    setConnectionStatus(reader.getStatus());
    return () => reader.close();
  }, [fifoPath, processEvent]);

  useEffect(() => {
    const readData = () => {
      setSettings(settingsReaderRef.current.read());
      setContextFiles(contextDetectorRef.current.detect(sessionInfo.cwd || undefined));
    };

    readData();
    const interval = setInterval(readData, 30000);
    return () => clearInterval(interval);
  }, [sessionInfo.cwd]);

  useEffect(() => {
    if (sessionInfo.transcriptPath) {
      contextTrackerRef.current.setTranscriptPath(sessionInfo.transcriptPath);
      setContext(contextTrackerRef.current.getHealth());
    }
  }, [sessionInfo.transcriptPath]);

  return {
    tools,
    todos,
    context,
    agents,
    sessionInfo,
    settings,
    contextFiles,
    connectionStatus,
    cost,
    model,
  };
}
