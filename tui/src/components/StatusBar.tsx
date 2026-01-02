import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { SettingsData } from '../lib/settings-reader.js';

interface Props {
  settings: SettingsData | null;
  isIdle: boolean;
  cwd?: string;
}

function truncatePath(p: string, maxLen: number): string {
  if (p.length <= maxLen) return p;
  const parts = p.split('/');
  if (parts.length <= 2) return '...' + p.slice(-(maxLen - 3));
  return '.../' + parts.slice(-2).join('/');
}

export const StatusBar = memo(function StatusBar({ settings, isIdle, cwd }: Props) {
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
      </Box>
      {cwd && (
        <Box>
          <Text dimColor>📁 {truncatePath(cwd, 38)}</Text>
        </Box>
      )}
    </Box>
  );
});
