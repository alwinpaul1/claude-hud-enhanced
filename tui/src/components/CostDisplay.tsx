import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { CostEstimate } from '../lib/types.js';

interface Props {
  cost: CostEstimate;
  model: string | null;
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) return '<$0.01';
  if (dollars < 1) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}

function getModelShortName(model: string | null): string {
  if (!model) return 'unknown';
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  return model.split('-').slice(-1)[0] || 'unknown';
}

export const CostDisplay = memo(function CostDisplay({ cost, model }: Props) {
  if (cost.totalCost === 0 && cost.inputTokens === 0) {
    return null;
  }

  const modelName = getModelShortName(model);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">
          Cost{' '}
        </Text>
        <Text dimColor>({modelName})</Text>
      </Box>
      <Box>
        <Text dimColor>
          {formatTokens(cost.inputTokens)} in / {formatTokens(cost.outputTokens)} out
        </Text>
      </Box>
      <Box>
        <Text color={cost.totalCost > 1 ? 'yellow' : 'green'}>{formatCost(cost.totalCost)}</Text>
        <Text dimColor> total</Text>
      </Box>
    </Box>
  );
});
