import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { ToolEntry } from '../lib/types.js';
import { formatDurationMs, truncatePath } from '../lib/ui-formatters.js';
import { getVisibleTools } from '../state/hud-selectors.js';

interface Props {
  tools: ToolEntry[];
  maxVisible?: number;
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

export const ToolStream = memo(function ToolStream({ tools, maxVisible = 4 }: Props) {
  const recentTools = getVisibleTools(tools, maxVisible);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">
          Tools
        </Text>
        {tools.length > 0 && <Text dimColor> ({tools.length})</Text>}
      </Box>
      {recentTools.length === 0 ? (
        <Text dimColor>No tool activity yet</Text>
      ) : (
        recentTools.map((tool) => {
          const duration = formatDurationMs(tool.duration);
          const target = truncatePath(tool.target, 22);

          return (
            <Box key={tool.id}>
              <Text color={STATUS_COLORS[tool.status]}>{STATUS_ICONS[tool.status]} </Text>
              <Text color="cyan">{tool.tool}</Text>
              {target && <Text dimColor>: {target}</Text>}
              {duration && (
                <Text dimColor color={tool.duration && tool.duration > 5000 ? 'yellow' : undefined}>
                  {' '}
                  ({duration})
                </Text>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
});
