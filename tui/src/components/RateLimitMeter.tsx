import React from 'react';
import { Box, Text } from 'ink';
import type { UsageData } from '../lib/usage-reader.js';

interface Props {
  usage: UsageData | null;
}

export function RateLimitMeter({ usage }: Props) {
  if (!usage) {
    return null;
  }

  const { sessionPercent, sessionResetTime } = usage;

  const barWidth = 20;
  const filled = Math.round((sessionPercent / 100) * barWidth);
  const empty = barWidth - filled;

  const color = sessionPercent >= 90 ? 'red' : sessionPercent >= 70 ? 'yellow' : 'gray';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Rate Limit</Text>
      <Box>
        <Text color={color}>{'█'.repeat(filled)}</Text>
        <Text dimColor>{'░'.repeat(empty)}</Text>
        <Text color={color}> {sessionPercent}%</Text>
      </Box>
      {sessionResetTime && (
        <Text dimColor>Resets {sessionResetTime}</Text>
      )}
    </Box>
  );
}
