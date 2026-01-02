import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { AgentEntry } from '../lib/types.js';
import { truncateDescription } from '../lib/ui-formatters.js';
import { getRecentAgents, getRunningAgentCount } from '../state/hud-selectors.js';

interface Props {
  agents: AgentEntry[];
  now: number;
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

function formatElapsed(startTs: number, endTs: number | undefined, now: number): string {
  const end = endTs || now;
  const elapsed = Math.max(0, end - startTs);

  if (elapsed < 1000) return '<1s';
  if (elapsed < 60000) return `${Math.round(elapsed / 1000)}s`;
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.round((elapsed % 60000) / 1000);
  return `${mins}m${secs}s`;
}

interface AgentItemProps {
  agent: AgentEntry;
  now: number;
}

const AgentItem = memo(function AgentItem({ agent, now }: AgentItemProps) {
  const elapsed = formatElapsed(agent.startTs, agent.endTs, now);

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
});

export const AgentList = memo(function AgentList({ agents, now }: Props) {
  const recentAgents = getRecentAgents(agents, 4);
  const runningCount = getRunningAgentCount(agents);

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
        <AgentItem key={agent.id} agent={agent} now={now} />
      ))}
    </Box>
  );
});
