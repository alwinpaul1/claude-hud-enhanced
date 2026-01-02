import React from 'react';
import { Box, Text } from 'ink';
import type { ContextFiles } from '../lib/context-detector.js';

interface Props {
  contextFiles: ContextFiles | null;
}

export function ContextInfo({ contextFiles }: Props) {
  if (!contextFiles) {
    return null;
  }

  const { globalClaudeMd, projectClaudeMd, projectSettings, projectSettingsRules } = contextFiles;
  const fileCount = [globalClaudeMd, projectClaudeMd, projectSettings].filter(Boolean).length;

  if (fileCount === 0) {
    return null;
  }

  const parts: string[] = [];
  if (globalClaudeMd || projectClaudeMd) {
    const mdCount = (globalClaudeMd ? 1 : 0) + (projectClaudeMd ? 1 : 0);
    parts.push(`${mdCount} CLAUDE.md`);
  }
  if (projectSettings && projectSettingsRules > 0) {
    parts.push(`${projectSettingsRules} rules`);
  }

  return (
    <Box marginBottom={1}>
      <Text dimColor>Context: </Text>
      <Text>{parts.join(', ')}</Text>
    </Box>
  );
}
