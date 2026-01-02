import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { useHudState } from './hooks/useHudState.js';
import { useElapsedTime } from './hooks/useElapsedTime.js';
import { ContextMeter } from './components/ContextMeter.js';
import { ToolStream } from './components/ToolStream.js';
import { TodoList } from './components/TodoList.js';
import { AgentList } from './components/AgentList.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { StatusBar } from './components/StatusBar.js';
import { ContextInfo } from './components/ContextInfo.js';
import { CostDisplay } from './components/CostDisplay.js';
import type { ConnectionStatus } from './lib/event-reader.js';

interface AppProps {
  fifoPath: string;
  initialTranscriptPath?: string;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  connecting: 'yellow',
  connected: 'green',
  disconnected: 'gray',
  error: 'red',
};

const STATUS_ICONS: Record<ConnectionStatus, string> = {
  connecting: '◐',
  connected: '●',
  disconnected: '○',
  error: '✗',
};

export function App({ fifoPath, initialTranscriptPath }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [termRows, setTermRows] = useState(stdout?.rows || 24);
  const [visible, setVisible] = useState(true);

  const state = useHudState({ fifoPath, initialTranscriptPath });
  const elapsed = useElapsedTime();

  useInput((input, key) => {
    if (key.ctrl && input === 'h') {
      setVisible((v) => !v);
    }
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  useEffect(() => {
    if (!stdout) return;
    const handleResize = () => setTermRows(stdout.rows || 24);
    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  if (!visible) {
    return (
      <Box>
        <Text dimColor>HUD hidden (Ctrl+H to show)</Text>
      </Box>
    );
  }

  const modeLabel =
    state.sessionInfo.permissionMode !== 'default' ? ` [${state.sessionInfo.permissionMode}]` : '';

  return (
    <Box flexDirection="column" width={48} height={termRows} borderStyle="round" borderColor="gray">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {' '}
          Claude HUD{' '}
        </Text>
        <Text dimColor>
          ({elapsed}){modeLabel}{' '}
        </Text>
        <Text color={STATUS_COLORS[state.connectionStatus]}>
          {STATUS_ICONS[state.connectionStatus]}
        </Text>
      </Box>

      {state.connectionStatus === 'disconnected' && (
        <Box marginBottom={1}>
          <Text dimColor>Waiting for session... (run claude or /resume)</Text>
        </Box>
      )}

      {state.connectionStatus === 'connecting' && (
        <Box marginBottom={1}>
          <Text color="yellow">Connecting to session...</Text>
        </Box>
      )}

      <ErrorBoundary>
        <StatusBar
          settings={state.settings}
          isIdle={state.sessionInfo.isIdle}
          cwd={state.sessionInfo.cwd}
        />
      </ErrorBoundary>

      <ErrorBoundary>
        <ContextMeter context={state.context} />
      </ErrorBoundary>

      <ErrorBoundary>
        <CostDisplay cost={state.cost} model={state.model} />
      </ErrorBoundary>

      <ErrorBoundary>
        <ContextInfo contextFiles={state.contextFiles} />
      </ErrorBoundary>

      <ErrorBoundary>
        <ToolStream tools={state.tools} />
      </ErrorBoundary>

      <ErrorBoundary>
        <AgentList agents={state.agents} />
      </ErrorBoundary>

      <ErrorBoundary>
        <TodoList todos={state.todos} />
      </ErrorBoundary>
    </Box>
  );
}
