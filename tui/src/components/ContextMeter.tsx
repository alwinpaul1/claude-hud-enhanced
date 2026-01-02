import React from 'react';
import { Box, Text } from 'ink';
import type { ContextHealth } from '../lib/types.js';
import type { TokenStats } from '../lib/stats-reader.js';
import { formatTokens } from '../lib/stats-reader.js';
import { Sparkline } from './Sparkline.js';

interface Props {
  context: ContextHealth;
  realStats?: TokenStats | null;
}

export function ContextMeter({ context, realStats }: Props) {
  const { tokens, percent, remaining, burnRate, status, shouldCompact, breakdown, tokenHistory } = context;

  const barWidth = 20;
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;

  const statusColors: Record<string, string> = {
    healthy: 'green',
    warning: 'yellow',
    critical: 'red',
  };
  const color = statusColors[status];

  const formatNumber = (n: number): string => {
    if (n >= 1000000) {
      return `${(n / 1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
      return `${(n / 1000).toFixed(0)}k`;
    }
    return n.toString();
  };

  const formatBurnRate = (rate: number): string => {
    if (rate === 0) return '--';
    return `${formatNumber(rate)}/min`;
  };

  const totalBreakdown = breakdown.toolOutputs + breakdown.toolInputs + breakdown.messages;
  const outputPercent = totalBreakdown > 0 ? Math.round((breakdown.toolOutputs / totalBreakdown) * 100) : 0;
  const inputPercent = totalBreakdown > 0 ? Math.round((breakdown.toolInputs / totalBreakdown) * 100) : 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">Context </Text>
        {shouldCompact && (
          <Text color="red" bold>⚠ COMPACT</Text>
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
      <Box>
        <Text dimColor>Burn: </Text>
        <Text color={burnRate > 5000 ? 'yellow' : 'white'}>{formatBurnRate(burnRate)}</Text>
        {totalBreakdown > 0 && (
          <>
            <Text dimColor> • </Text>
            <Text dimColor>Out:{outputPercent}% In:{inputPercent}%</Text>
          </>
        )}
      </Box>
      {realStats && (
        <Box>
          <Text dimColor>Today: </Text>
          <Text>{formatTokens(realStats.todayTokens)}</Text>
          <Text dimColor> • </Text>
          <Text dimColor>{realStats.todayMessages} msgs</Text>
          {realStats.cacheReadTokens > 0 && (
            <>
              <Text dimColor> • </Text>
              <Text color="cyan">{formatTokens(realStats.cacheReadTokens)} cached</Text>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
