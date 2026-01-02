import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import minimist from 'minimist';
import { EventReader } from './lib/event-reader.js';
import { ContextTracker } from './lib/context-tracker.js';
import { CostTracker } from './lib/cost-tracker.js';
import { ContextMeter } from './components/ContextMeter.js';
import { ToolStream } from './components/ToolStream.js';
import { McpStatus } from './components/McpStatus.js';
import { TodoList } from './components/TodoList.js';
import { ModifiedFiles } from './components/ModifiedFiles.js';
import { AgentList } from './components/AgentList.js';
import { SessionStats } from './components/SessionStats.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { GitStatus } from './components/GitStatus.js';
import type { ConnectionStatus } from './lib/event-reader.js';
import type { HudEvent, ToolEntry, TodoItem, ModifiedFile, ContextHealth, AgentEntry, SessionInfo, CostEstimate } from './lib/types.js';

interface AppProps {
  sessionId: string;
  fifoPath: string;
}

function App({ sessionId, fifoPath }: AppProps) {
  const { exit } = useApp();
  const [visible, setVisible] = useState(true);
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [modifiedFiles, setModifiedFiles] = useState<Map<string, ModifiedFile>>(new Map());
  const contextTrackerRef = useRef(new ContextTracker());
  const costTrackerRef = useRef(new CostTracker());
  const [context, setContext] = useState<ContextHealth>(contextTrackerRef.current.getHealth());
  const [cost, setCost] = useState<CostEstimate>(costTrackerRef.current.getCost());
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [sessionStart] = useState(Date.now());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({
    permissionMode: 'default',
    cwd: '',
    transcriptPath: '',
    isIdle: true,
    lastPrompt: '',
    compactionCount: 0,
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

      // Process for context and cost tracking
      contextTrackerRef.current.processEvent(event);
      costTrackerRef.current.processEvent(event);
      setContext(contextTrackerRef.current.getHealth());
      setCost(costTrackerRef.current.getCost());
    }

    // Handle UserPromptSubmit
    if (event.event === 'UserPromptSubmit') {
      setSessionInfo((prev) => ({
        ...prev,
        isIdle: false,
        lastPrompt: event.prompt?.slice(0, 100) || '',
      }));
      costTrackerRef.current.processEvent(event);
      setCost(costTrackerRef.current.getCost());
    }

    // Handle Stop - Claude finished responding
    if (event.event === 'Stop') {
      setSessionInfo((prev) => ({ ...prev, isIdle: true }));
    }

    // Handle PreCompact
    if (event.event === 'PreCompact') {
      setSessionInfo((prev) => ({
        ...prev,
        compactionCount: prev.compactionCount + 1,
      }));
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

    // Handle Edit/Write for modified files
    if ((event.tool === 'Edit' || event.tool === 'Write') && event.event === 'PostToolUse') {
      const input = event.input as { file_path?: string };
      const response = event.response as { success?: boolean };
      if (input?.file_path && response?.success !== false) {
        setModifiedFiles((prev) => {
          const next = new Map(prev);
          const existing = next.get(input.file_path!) || { path: input.file_path!, additions: 0, deletions: 0 };
          existing.additions += 1;
          next.set(input.file_path!, existing);
          return next;
        });
      }
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
    setMcpServers(['context7', 'exa', 'grep-app']);
  }, []);

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

  const idleIndicator = sessionInfo.isIdle ? '💤' : '⚡';
  const modeLabel = sessionInfo.permissionMode !== 'default' ? ` [${sessionInfo.permissionMode}]` : '';

  return (
    <Box flexDirection="column" width={48} borderStyle="round" borderColor="gray">
      <Box marginBottom={1}>
        <Text bold color="cyan"> Claude HUD </Text>
        <Text>{idleIndicator}</Text>
        <Text dimColor> ({sessionId.slice(0, 8)}){modeLabel} </Text>
        <Text color={statusColors[connectionStatus]}>{statusIcons[connectionStatus]}</Text>
      </Box>

      <ErrorBoundary>
        <ContextMeter context={context} />
      </ErrorBoundary>

      {cost.totalCost > 0.001 && (
        <Box marginBottom={1}>
          <Text dimColor>Cost: </Text>
          <Text color="green">${cost.totalCost.toFixed(4)}</Text>
          <Text dimColor> (in: ${cost.inputCost.toFixed(4)} / out: ${cost.outputCost.toFixed(4)})</Text>
        </Box>
      )}

      {sessionInfo.compactionCount > 0 && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ Compacted {sessionInfo.compactionCount}x</Text>
        </Box>
      )}

      <ErrorBoundary>
        <SessionStats
          tools={tools}
          modifiedFiles={modifiedFiles}
          agents={agents}
          sessionStart={sessionStart}
        />
      </ErrorBoundary>
      <ErrorBoundary>
        <ToolStream tools={tools} />
      </ErrorBoundary>
      <ErrorBoundary>
        <AgentList agents={agents} />
      </ErrorBoundary>
      <ErrorBoundary>
        <GitStatus cwd={sessionInfo.cwd || undefined} />
      </ErrorBoundary>
      <ErrorBoundary>
        <McpStatus servers={mcpServers} />
      </ErrorBoundary>
      <ErrorBoundary>
        <TodoList todos={todos} />
      </ErrorBoundary>
      <ErrorBoundary>
        <ModifiedFiles files={modifiedFiles} />
      </ErrorBoundary>

      {sessionInfo.lastPrompt && (
        <Box marginTop={1}>
          <Text dimColor>Last: "{sessionInfo.lastPrompt.slice(0, 35)}..."</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Ctrl+H toggle • Ctrl+C exit</Text>
      </Box>
    </Box>
  );
}

const args = minimist(process.argv.slice(2));
const sessionId = args.session || 'unknown';
const fifoPath = args.fifo || '';

if (!fifoPath) {
  console.error('Usage: node index.js --session <id> --fifo <path>');
  process.exit(1);
}

render(<App sessionId={sessionId} fifoPath={fifoPath} />);
