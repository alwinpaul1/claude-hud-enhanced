import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { AgentEntry } from '../lib/types.js';

interface Props {
  agents: AgentEntry[];
}

const STATUS_ICONS: Record<string, string> = {
  running: '◐',
  complete: '✓',
  error: '✗',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'yellow',
  complete: 'green',
  error: 'red',
};

const TOOL_STATUS_COLORS: Record<string, string> = {
  running: 'yellow',
  complete: 'gray',
  error: 'red',
};

function formatElapsed(startTs: number, endTs?: number): string {
  const end = endTs || Date.now();
  const elapsed = Math.max(0, end - startTs);

  if (elapsed < 1000) return '<1s';
  if (elapsed < 60000) return `${Math.round(elapsed / 1000)}s`;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.round((elapsed % 60000) / 1000);
  return `${mins}m${secs}s`;
}

function truncateDescription(desc: string, maxLen: number = 25): string {
  if (!desc || desc.length <= maxLen) return desc;
  return `${desc.slice(0, maxLen - 1)}…`;
}

interface AgentItemProps {
  agent: AgentEntry;
}

function AgentItem({ agent }: AgentItemProps) {
  const [elapsed, setElapsed] = useState(formatElapsed(agent.startTs, agent.endTs));

  useEffect(() => {
    if (agent.status !== 'running') return;

    const interval = setInterval(() => {
      setElapsed(formatElapsed(agent.startTs));
    }, 1000);

    return () => clearInterval(interval);
  }, [agent.status, agent.startTs]);

  const recentTools = agent.tools.slice(-3);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={STATUS_COLORS[agent.status]}>{STATUS_ICONS[agent.status]} </Text>
        <Text color="magenta" bold>
          {agent.type}
        </Text>
        <Text dimColor> ({elapsed})</Text>
      </Box>
      {agent.description && (
        <Box marginLeft={2}>
          <Text dimColor>→ {truncateDescription(agent.description)}</Text>
        </Box>
      )}
      {recentTools.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {recentTools.map((tool) => (
            <Box key={tool.id}>
              <Text color={TOOL_STATUS_COLORS[tool.status]}>· </Text>
              <Text dimColor>{tool.tool}</Text>
              {tool.target && (
                <Text dimColor color="gray">
                  : {tool.target.split('/').pop()?.slice(0, 15)}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function AgentList({ agents }: Props) {
  const recentAgents = agents.slice(-4);
  const runningCount = agents.filter((a) => a.status === 'running').length;

  if (recentAgents.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">
          Agents
        </Text>
        {runningCount > 0 && <Text color="yellow"> ({runningCount} active)</Text>}
      </Box>
      {recentAgents.map((agent) => (
        <AgentItem key={agent.id} agent={agent} />
      ))}
    </Box>
  );
}
