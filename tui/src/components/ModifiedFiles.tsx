import React from 'react';
import { Box, Text } from 'ink';
import type { ModifiedFile } from '../lib/types.js';

interface Props {
  files: Map<string, ModifiedFile>;
}

export function ModifiedFiles({ files }: Props) {
  const fileList = Array.from(files.values()).slice(-6);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">
        Modified
      </Text>
      {fileList.length === 0 ? (
        <Text dimColor>No files modified</Text>
      ) : (
        fileList.map((file) => {
          const filename = file.path.split('/').pop() || file.path;
          return (
            <Box key={file.path}>
              <Text>{filename.slice(0, 25)}</Text>
              <Text color="green"> +{file.additions}</Text>
            </Box>
          );
        })
      )}
      {files.size > 6 && <Text dimColor>+{files.size - 6} more</Text>}
    </Box>
  );
}
