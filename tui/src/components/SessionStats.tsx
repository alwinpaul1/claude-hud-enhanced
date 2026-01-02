import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { ToolEntry, ModifiedFile, AgentEntry } from '../lib/types.js';

interface Props {
  tools: ToolEntry[];
  modifiedFiles: Map<string, ModifiedFile>;
  agents: AgentEntry[];
  sessionStart: number;
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

function getToolCounts(tools: ToolEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tool of tools) {
    counts.set(tool.tool, (counts.get(tool.tool) || 0) + 1);
  }
  return counts;
}

export function SessionStats({ tools, modifiedFiles, agents, sessionStart }: Props) {
  const [elapsed, setElapsed] = useState(formatDuration(Date.now() - sessionStart));

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(formatDuration(Date.now() - sessionStart));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStart]);

  const toolCounts = getToolCounts(tools);
  const totalAdditions = Array.from(modifiedFiles.values()).reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = Array.from(modifiedFiles.values()).reduce((sum, f) => sum + f.deletions, 0);
  const completedAgents = agents.filter((a) => a.status === 'complete').length;

  const topTools = Array.from(toolCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">Session</Text>
        <Text dimColor> ({elapsed})</Text>
      </Box>

      {topTools.length > 0 && (
        <Box>
          <Text dimColor>
            {topTools.map(([tool, count], i) => (
              <Text key={tool}>
                {i > 0 && ' · '}
                <Text color="cyan">{count}</Text>
                <Text dimColor> {tool.slice(0, 6)}</Text>
              </Text>
            ))}
          </Text>
        </Box>
      )}

      <Box>
        {modifiedFiles.size > 0 && (
          <>
            <Text color="green">+{totalAdditions}</Text>
            <Text dimColor>/</Text>
            <Text color="red">-{totalDeletions}</Text>
            <Text dimColor> in {modifiedFiles.size} files</Text>
          </>
        )}
        {completedAgents > 0 && (
          <Text dimColor>
            {modifiedFiles.size > 0 && ' · '}
            {completedAgents} agents
          </Text>
        )}
      </Box>
    </Box>
  );
}
