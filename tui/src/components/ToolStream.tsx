import React from 'react';
import { Box, Text } from 'ink';
import type { ToolEntry } from '../lib/types.js';

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

function truncatePath(path: string, maxLen: number = 22): string {
  if (!path || path.length <= maxLen) return path;

  const parts = path.split('/');
  if (parts.length >= 2) {
    const filename = parts[parts.length - 1];
    const parent = parts[parts.length - 2];

    if (filename.length > maxLen - 4) {
      return `…${filename.slice(-(maxLen - 1))}`;
    }

    const combined = `${parent}/${filename}`;
    if (combined.length <= maxLen) {
      return combined;
    }

    const available = maxLen - filename.length - 2;
    if (available > 0) {
      return `…${parent.slice(-available)}/${filename}`;
    }
    return `…/${filename}`;
  }

  return `…${path.slice(-(maxLen - 1))}`;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export function ToolStream({ tools, maxVisible = 4 }: Props) {
  const recentTools = tools.slice(-maxVisible);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">Tools</Text>
        {tools.length > 0 && (
          <Text dimColor> ({tools.length})</Text>
        )}
      </Box>
      {recentTools.length === 0 ? (
        <Text dimColor>No tool activity yet</Text>
      ) : (
        recentTools.map((tool) => {
          const duration = formatDuration(tool.duration);
          const target = truncatePath(tool.target);

          return (
            <Box key={tool.id}>
              <Text color={STATUS_COLORS[tool.status]}>{STATUS_ICONS[tool.status]} </Text>
              <Text color="cyan">{tool.tool}</Text>
              {target && (
                <Text dimColor>: {target}</Text>
              )}
              {duration && (
                <Text dimColor color={tool.duration && tool.duration > 5000 ? 'yellow' : undefined}>
                  {' '}({duration})
                </Text>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}
