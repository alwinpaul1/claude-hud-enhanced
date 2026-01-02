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

  if (!globalClaudeMd && !projectClaudeMd && !projectSettings) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold dimColor>Context Files</Text>
      {globalClaudeMd && (
        <Box>
          <Text dimColor>├ </Text>
          <Text color="green">✓</Text>
          <Text dimColor> ~/.claude/CLAUDE.md</Text>
        </Box>
      )}
      {projectClaudeMd && (
        <Box>
          <Text dimColor>├ </Text>
          <Text color="green">✓</Text>
          <Text dimColor> CLAUDE.md (project)</Text>
        </Box>
      )}
      {projectSettings && (
        <Box>
          <Text dimColor>└ </Text>
          <Text color="blue">⚙</Text>
          <Text dimColor> .claude/settings ({projectSettingsRules} rules)</Text>
        </Box>
      )}
    </Box>
  );
}
