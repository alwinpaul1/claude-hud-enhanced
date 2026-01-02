import React from 'react';
import { Box, Text } from 'ink';
import type { ModifiedFile } from '../lib/types.js';

interface Props {
  files: Map<string, ModifiedFile>;
}

export function Edits({ files }: Props) {
  if (files.size === 0) {
    return null;
  }

  const totalAdditions = Array.from(files.values()).reduce((sum, f) => sum + f.additions, 0);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>Edits</Text>
      <Text dimColor>+{totalAdditions} lines in {files.size} file{files.size !== 1 ? 's' : ''}</Text>
    </Box>
  );
}
