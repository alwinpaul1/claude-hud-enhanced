import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  servers: string[];
  plugins?: string[];
}

export function McpStatus({ servers, plugins }: Props) {
  if (servers.length === 0 && (!plugins || plugins.length === 0)) {
    return null;
  }

  const maxShow = 3;
  const serverDisplay = servers.slice(0, maxShow);
  const serverExtra = servers.length - maxShow;

  const pluginDisplay = plugins?.slice(0, maxShow) || [];
  const pluginExtra = (plugins?.length || 0) - maxShow;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold dimColor>
        Connections
      </Text>
      {servers.length > 0 && (
        <Box>
          <Text dimColor>MCP: </Text>
          <Text>{serverDisplay.join(' • ')}</Text>
          {serverExtra > 0 && <Text dimColor> +{serverExtra}</Text>}
        </Box>
      )}
      {plugins && plugins.length > 0 && (
        <Box>
          <Text dimColor>Plugins: </Text>
          <Text>{pluginDisplay.join(' • ')}</Text>
          {pluginExtra > 0 && <Text dimColor> +{pluginExtra}</Text>}
        </Box>
      )}
    </Box>
  );
}
