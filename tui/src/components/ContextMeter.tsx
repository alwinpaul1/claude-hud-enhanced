import React from 'react';
import { Box, Text } from 'ink';
import type { ContextState } from '../lib/types.js';

interface Props {
  context: ContextState;
}

export function ContextMeter({ context }: Props) {
  const { tokens, percent, remaining } = context;

  const barWidth = 20;
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;

  let color: string;
  if (percent < 50) {
    color = 'green';
  } else if (percent < 80) {
    color = 'yellow';
  } else {
    color = 'red';
  }

  const formatNumber = (n: number): string => {
    if (n >= 1000) {
      return `${(n / 1000).toFixed(0)}k`;
    }
    return n.toString();
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">Context</Text>
      <Box>
        <Text color={color}>{'█'.repeat(filled)}</Text>
        <Text dimColor>{'░'.repeat(empty)}</Text>
        <Text> {percent}%</Text>
      </Box>
      <Text dimColor>
        {formatNumber(tokens)} tokens • {formatNumber(remaining)} remaining
      </Text>
    </Box>
  );
}
