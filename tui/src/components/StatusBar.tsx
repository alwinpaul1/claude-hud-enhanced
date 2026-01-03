import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { SettingsData } from '../lib/settings-reader.js';
import { truncatePathTail } from '../lib/ui-formatters.js';

interface Props {
  settings: SettingsData | null;
  isIdle: boolean;
  cwd?: string;
  parseErrorCount?: number;
}

export const StatusBar = memo(function StatusBar({
  settings,
  isIdle,
  cwd,
  parseErrorCount = 0,
}: Props) {
  const idleIndicator = isIdle ? '💤' : '⚡';
  const model = settings?.model || '?';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="magenta">
          {model}
        </Text>
        <Text> {idleIndicator} </Text>
        {settings && (
          <>
            <Text dimColor>plugins:</Text>
            <Text>{settings.pluginCount}</Text>
            <Text dimColor> • </Text>
            <Text dimColor>MCP:</Text>
            <Text>{settings.mcpCount}</Text>
          </>
        )}
        {parseErrorCount > 0 && (
          <>
            <Text dimColor> • </Text>
            <Text color="yellow">⚠ {parseErrorCount} parse errors</Text>
          </>
        )}
      </Box>
      {cwd && (
        <Box>
          <Text dimColor>📁 {truncatePathTail(cwd, 38)}</Text>
        </Box>
      )}
    </Box>
  );
});
