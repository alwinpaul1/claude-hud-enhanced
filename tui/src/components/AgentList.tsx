import React from 'react';
import { Box, Text } from 'ink';
import type { AgentEntry } from '../lib/types.js';

interface Props {
  agents: AgentEntry[];
}

const STATUS_ICONS: Record<string, string> = {
  running: '●',
  complete: '✓',
  error: '✗',
};

const STATUS_COLORS: Record<string, string> = {
  running: 'yellow',
  complete: 'green',
  error: 'red',
};

export function AgentList({ agents }: Props) {
  const recentAgents = agents.slice(-5);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">Agents</Text>
      {recentAgents.length === 0 ? (
        <Text dimColor>No subagents spawned</Text>
      ) : (
        recentAgents.map((agent) => (
          <Box key={agent.id}>
            <Text color={STATUS_COLORS[agent.status]}>{STATUS_ICONS[agent.status]} </Text>
            <Text color="magenta">{agent.type}</Text>
            {agent.description && (
              <Text dimColor> {agent.description.slice(0, 20)}</Text>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}
