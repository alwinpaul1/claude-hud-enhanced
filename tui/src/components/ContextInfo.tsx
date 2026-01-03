import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { ContextFiles } from '../lib/context-detector.js';

interface Props {
  contextFiles: ContextFiles | null;
}

export const ContextInfo = memo(function ContextInfo({ contextFiles }: Props) {
  if (!contextFiles) {
    return null;
  }

  const { globalClaudeMd, projectClaudeMd, rulesCount } = contextFiles;
  const fileCount = [globalClaudeMd, projectClaudeMd, rulesCount > 0].filter(Boolean).length;

  if (fileCount === 0) {
    return null;
  }

  const parts: string[] = [];
  if (globalClaudeMd || projectClaudeMd) {
    const mdCount = (globalClaudeMd ? 1 : 0) + (projectClaudeMd ? 1 : 0);
    parts.push(`${mdCount} CLAUDE.md`);
  }
  if (rulesCount > 0) {
    parts.push(`${rulesCount} rules`);
  }

  return (
    <Box marginBottom={1}>
      <Text dimColor>Context: </Text>
      <Text>{parts.join(', ')}</Text>
    </Box>
  );
});
