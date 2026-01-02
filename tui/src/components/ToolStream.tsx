import React from 'react';
import { Box, Text } from 'ink';
import type { ToolEntry } from '../lib/types.js';

interface Props {
  tools: ToolEntry[];
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

export function ToolStream({ tools }: Props) {
  const recentTools = tools.slice(-8);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">Tools</Text>
      {recentTools.length === 0 ? (
        <Text dimColor>No tool activity yet</Text>
      ) : (
        recentTools.map((tool, i) => (
          <Box key={tool.id}>
            <Text color={STATUS_COLORS[tool.status]}>{STATUS_ICONS[tool.status]} </Text>
            <Text color="cyan">{tool.tool}</Text>
            {tool.target && (
              <Text dimColor>: {tool.target.slice(0, 25)}</Text>
            )}
          </Box>
        ))
      )}
    </Box>
  );
}
