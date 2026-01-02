import React from 'react';
import { Text } from 'ink';

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

interface Props {
  data: number[];
  width?: number;
  color?: string;
}

export function Sparkline({ data, width = 20, color = 'cyan' }: Props) {
  if (data.length === 0) {
    return <Text dimColor>{'─'.repeat(width)}</Text>;
  }

  const samples = data.slice(-width);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min;

  const sparkline = samples
    .map((value) => {
      if (range === 0) return BLOCKS[0];
      const normalized = (value - min) / range;
      const index = Math.min(Math.floor(normalized * BLOCKS.length), BLOCKS.length - 1);
      return BLOCKS[index];
    })
    .join('');

  const padding = width - samples.length;
  const padStr = padding > 0 ? '─'.repeat(padding) : '';

  return (
    <Text>
      <Text dimColor>{padStr}</Text>
      <Text color={color}>{sparkline}</Text>
    </Text>
  );
}
