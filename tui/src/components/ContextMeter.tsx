import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { ContextHealth } from '../lib/types.js';
import { Sparkline } from './Sparkline.js';

interface Props {
  context: ContextHealth;
}

const STATUS_COLORS: Record<string, string> = {
  healthy: 'green',
  warning: 'yellow',
  critical: 'red',
};

function formatNumber(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}k`;
  }
  return n.toString();
}

export const ContextMeter = memo(function ContextMeter({ context }: Props) {
  const { tokens, percent, remaining, status, shouldCompact, tokenHistory } = context;

  const barWidth = 20;
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;
  const color = STATUS_COLORS[status];

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">
          Context{' '}
        </Text>
        {shouldCompact && (
          <Text color="red" bold>
            ⚠ COMPACT
          </Text>
        )}
      </Box>
      <Box>
        <Text color={color}>{'█'.repeat(filled)}</Text>
        <Text dimColor>{'░'.repeat(empty)}</Text>
        <Text color={color}> {percent}%</Text>
      </Box>
      <Box>
        <Sparkline data={tokenHistory} width={20} color={color} />
        <Text dimColor> usage</Text>
      </Box>
      <Box>
        <Text dimColor>{formatNumber(tokens)} used</Text>
        <Text dimColor> • </Text>
        <Text dimColor>{formatNumber(remaining)} left</Text>
      </Box>
    </Box>
  );
});
