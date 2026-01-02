import React, { useState, useEffect, useCallback, useRef } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import minimist from 'minimist';
import { EventReader } from './lib/event-reader.js';
import { ContextTracker } from './lib/context-tracker.js';
import { ContextMeter } from './components/ContextMeter.js';
import { ToolStream } from './components/ToolStream.js';
import { McpStatus } from './components/McpStatus.js';
import { TodoList } from './components/TodoList.js';
import { ModifiedFiles } from './components/ModifiedFiles.js';
import { AgentList } from './components/AgentList.js';
import type { HudEvent, ToolEntry, TodoItem, ModifiedFile, ContextHealth, AgentEntry } from './lib/types.js';

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
  const [context, setContext] = useState<ContextHealth>(contextTrackerRef.current.getHealth());
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [agents, setAgents] = useState<AgentEntry[]>([]);

  useInput((input, key) => {
    if (key.ctrl && input === 'h') {
      setVisible((v) => !v);
    }
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const processEvent = useCallback((event: HudEvent) => {
    if (event.tool === 'TodoWrite' && event.input) {
      const todoInput = event.input as { todos?: TodoItem[] };
      if (todoInput.todos) {
        setTodos(todoInput.todos);
      }
    }

    if (event.tool === 'Task' && event.input) {
      const taskInput = event.input as { subagent_type?: string; description?: string };
      const agentEntry: AgentEntry = {
        id: `${event.ts}-${taskInput.subagent_type || 'unknown'}`,
        type: taskInput.subagent_type || 'Task',
        description: taskInput.description || '',
        status: 'running',
        startTs: event.ts,
      };
      setAgents((prev) => [...prev.slice(-10), agentEntry]);
    }

    if (event.event === 'SubagentStop') {
      setAgents((prev) => {
        const updated = [...prev];
        const runningIdx = updated.findIndex((a) => a.status === 'running');
        if (runningIdx !== -1) {
          updated[runningIdx] = { ...updated[runningIdx], status: 'complete', endTs: event.ts };
        }
        return updated;
      });
    }

    if (event.tool === 'Edit' || event.tool === 'Write') {
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

    if (event.tool) {
      const input = event.input as { file_path?: string; command?: string; pattern?: string } | null;
      let target = '';
      if (input?.file_path) {
        target = input.file_path;
      } else if (input?.command) {
        target = input.command.slice(0, 40);
      } else if (input?.pattern) {
        target = input.pattern.slice(0, 30);
      }

      const response = event.response as { error?: string; duration_ms?: number } | null;
      const hasError = response?.error !== undefined;
      const now = Date.now();

      const entry: ToolEntry = {
        id: `${event.ts}-${event.tool}-${now}`,
        tool: event.tool,
        target,
        status: hasError ? 'error' : 'complete',
        ts: event.ts,
        startTs: event.ts * 1000,
        endTs: now,
        duration: response?.duration_ms || (now - event.ts * 1000),
      };

      setTools((prev) => [...prev.slice(-30), entry]);

      contextTrackerRef.current.processEvent(event);
      setContext(contextTrackerRef.current.getHealth());
    }
  }, []);

  useEffect(() => {
    const reader = new EventReader(fifoPath);
    reader.on('event', processEvent);
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

  return (
    <Box flexDirection="column" width={45} borderStyle="round" borderColor="gray">
      <Box marginBottom={1}>
        <Text bold color="cyan"> Claude HUD </Text>
        <Text dimColor>({sessionId.slice(0, 8)})</Text>
      </Box>

      <ContextMeter context={context} />
      <ToolStream tools={tools} />
      <AgentList agents={agents} />
      <McpStatus servers={mcpServers} />
      <TodoList todos={todos} />
      <ModifiedFiles files={modifiedFiles} />

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
