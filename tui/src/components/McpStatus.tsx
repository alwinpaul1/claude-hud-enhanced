import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  servers: string[];
}

export function McpStatus({ servers }: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="white">MCP</Text>
      {servers.length === 0 ? (
        <Text dimColor>No MCP servers</Text>
      ) : (
        servers.map((server) => (
          <Box key={server}>
            <Text color="green">● </Text>
            <Text>{server}</Text>
            <Text dimColor> Connected</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
