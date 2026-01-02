import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { EventReader } from './lib/event-reader.js';
import { ContextTracker } from './lib/context-tracker.js';
import { SettingsReader } from './lib/settings-reader.js';
import { ContextDetector } from './lib/context-detector.js';
import { TranscriptReader } from './lib/transcript-reader.js';
import { ContextMeter } from './components/ContextMeter.js';
import { ToolStream } from './components/ToolStream.js';
import { TodoList } from './components/TodoList.js';
import { AgentList } from './components/AgentList.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { StatusBar } from './components/StatusBar.js';
import { ContextInfo } from './components/ContextInfo.js';
import type { ConnectionStatus } from './lib/event-reader.js';
import type { SettingsData } from './lib/settings-reader.js';
import type { ContextFiles } from './lib/context-detector.js';
import type { HudEvent, ToolEntry, TodoItem, ContextHealth, AgentEntry, SessionInfo } from './lib/types.js';

interface AppProps {
  fifoPath: string;
  initialTranscriptPath?: string;
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

export function App({ fifoPath, initialTranscriptPath }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [termRows, setTermRows] = useState(stdout?.rows || 24);
  const [visible, setVisible] = useState(true);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const contextTrackerRef = useRef(new ContextTracker());
  const settingsReaderRef = useRef(new SettingsReader());
  const contextDetectorRef = useRef(new ContextDetector());
  const transcriptReaderRef = useRef(new TranscriptReader());
  const [context, setContext] = useState<ContextHealth>(contextTrackerRef.current.getHealth());
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [contextFiles, setContextFiles] = useState<ContextFiles | null>(null);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [sessionStart] = useState(Date.now());
  const [elapsed, setElapsed] = useState('0s');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({
    permissionMode: 'default',
    cwd: '',
    transcriptPath: initialTranscriptPath || '',
    isIdle: true,
  });
  const runningToolsRef = useRef<Map<string, ToolEntry>>(new Map());

  useInput((input, key) => {
    if (key.ctrl && input === 'h') {
      setVisible((v) => !v);
    }
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const processEvent = useCallback((event: HudEvent) => {
    // Update session info from any event that has it
    if (event.permissionMode || event.cwd || event.transcriptPath) {
      setSessionInfo((prev) => ({
        ...prev,
        permissionMode: event.permissionMode || prev.permissionMode,
        cwd: event.cwd || prev.cwd,
        transcriptPath: event.transcriptPath || prev.transcriptPath,
      }));
    }

    // Handle PreToolUse - mark tool as running
    if (event.event === 'PreToolUse' && event.tool && event.toolUseId) {
      const input = event.input as { file_path?: string; command?: string; pattern?: string } | null;
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

    // Handle PostToolUse - update tool status
    if (event.event === 'PostToolUse' && event.tool) {
      const response = event.response as { error?: string; duration_ms?: number } | null;
      const hasError = response?.error !== undefined;
      const now = Date.now();
      const toolUseId = event.toolUseId || `${event.ts}-${event.tool}`;

      const existingTool = runningToolsRef.current.get(toolUseId);
      const startTs = existingTool?.startTs || event.ts * 1000;

      setTools((prev) => {
        const idx = prev.findIndex((t) => t.id === toolUseId);
        const entry: ToolEntry = {
          id: toolUseId,
          tool: event.tool!,
          target: existingTool?.target || '',
          status: hasError ? 'error' : 'complete',
          ts: event.ts,
          startTs,
          endTs: now,
          duration: response?.duration_ms || (now - startTs),
        };

        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = entry;
          return updated;
        }
        return [...prev.slice(-29), entry];
      });

      runningToolsRef.current.delete(toolUseId);

      contextTrackerRef.current.processEvent(event);
      setContext(contextTrackerRef.current.getHealth());
    }

    if (event.event === 'UserPromptSubmit') {
      setSessionInfo((prev) => ({
        ...prev,
        isIdle: false,
      }));
    }

    // Handle Stop - Claude finished responding
    if (event.event === 'Stop') {
      setSessionInfo((prev) => ({ ...prev, isIdle: true }));
    }

    // Handle TodoWrite
    if (event.tool === 'TodoWrite' && event.input) {
      const todoInput = event.input as { todos?: TodoItem[] };
      if (todoInput.todos) {
        setTodos(todoInput.todos);
      }
    }

    // Handle Task (agent spawn)
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

    // Handle SubagentStop
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
    const interval = setInterval(() => {
      setElapsed(formatDuration(Date.now() - sessionStart));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStart]);

  useEffect(() => {
    if (!stdout) return;
    const handleResize = () => setTermRows(stdout.rows || 24);
    stdout.on('resize', handleResize);
    return () => { stdout.off('resize', handleResize); };
  }, [stdout]);

  useEffect(() => {
    const readData = () => {
      setSettings(settingsReaderRef.current.read());
      setContextFiles(contextDetectorRef.current.detect(sessionInfo.cwd || undefined));
    };

    readData();
    const interval = setInterval(readData, 30000);
    return () => clearInterval(interval);
  }, [sessionInfo.cwd]);

  // Read transcript for real context data (especially important on session resume)
  useEffect(() => {
    if (!sessionInfo.transcriptPath) return;

    const readTranscript = () => {
      const health = transcriptReaderRef.current.getContextHealth(sessionInfo.transcriptPath);
      if (health) {
        setContext(health);
      }
    };

    readTranscript();
    const interval = setInterval(readTranscript, 5000);
    return () => clearInterval(interval);
  }, [sessionInfo.transcriptPath]);

  if (!visible) {
    return (
      <Box>
        <Text dimColor>HUD hidden (Ctrl+H to show)</Text>
      </Box>
    );
  }

  const statusColors: Record<ConnectionStatus, string> = {
    connecting: 'yellow',
    connected: 'green',
    disconnected: 'gray',
    error: 'red',
  };
  const statusIcons: Record<ConnectionStatus, string> = {
    connecting: '◐',
    connected: '●',
    disconnected: '○',
    error: '✗',
  };

  const modeLabel = sessionInfo.permissionMode !== 'default' ? ` [${sessionInfo.permissionMode}]` : '';

  return (
    <Box flexDirection="column" width={48} height={termRows} borderStyle="round" borderColor="gray">
      <Box marginBottom={1}>
        <Text bold color="cyan"> Claude HUD </Text>
        <Text dimColor>({elapsed}){modeLabel} </Text>
        <Text color={statusColors[connectionStatus]}>{statusIcons[connectionStatus]}</Text>
      </Box>

      {connectionStatus === 'disconnected' && (
        <Box marginBottom={1}>
          <Text dimColor>Waiting for session... (run claude or /resume)</Text>
        </Box>
      )}

      {connectionStatus === 'connecting' && (
        <Box marginBottom={1}>
          <Text color="yellow">Connecting to session...</Text>
        </Box>
      )}

      <ErrorBoundary>
        <StatusBar settings={settings} isIdle={sessionInfo.isIdle} cwd={sessionInfo.cwd} />
      </ErrorBoundary>

      <ErrorBoundary>
        <ContextMeter context={context} />
      </ErrorBoundary>

      <ErrorBoundary>
        <ContextInfo contextFiles={contextFiles} />
      </ErrorBoundary>

      <ErrorBoundary>
        <ToolStream tools={tools} />
      </ErrorBoundary>
      <ErrorBoundary>
        <AgentList agents={agents} />
      </ErrorBoundary>
      <ErrorBoundary>
        <TodoList todos={todos} />
      </ErrorBoundary>
    </Box>
  );
}
