import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { execSync } from 'child_process';

interface GitInfo {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
}

interface Props {
  cwd?: string;
}

function getGitInfo(cwd?: string): GitInfo | null {
  try {
    const options = cwd ? { cwd, encoding: 'utf8' as const } : { encoding: 'utf8' as const };

    // Get current branch
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', options).trim();

    // Get ahead/behind
    let ahead = 0;
    let behind = 0;
    try {
      const upstream = execSync('git rev-parse --abbrev-ref @{upstream} 2>/dev/null', options).trim();
      if (upstream) {
        const aheadBehind = execSync(`git rev-list --left-right --count HEAD...${upstream} 2>/dev/null`, options).trim();
        const [aheadStr, behindStr] = aheadBehind.split(/\s+/);
        ahead = parseInt(aheadStr, 10) || 0;
        behind = parseInt(behindStr, 10) || 0;
      }
    } catch {
      // No upstream configured
    }

    // Get status counts
    const status = execSync('git status --porcelain 2>/dev/null', options);
    const lines = status.split('\n').filter(Boolean);

    let staged = 0;
    let modified = 0;
    let untracked = 0;

    for (const line of lines) {
      const x = line[0];
      const y = line[1];

      if (x === '?' && y === '?') {
        untracked++;
      } else {
        if (x !== ' ' && x !== '?') staged++;
        if (y !== ' ' && y !== '?') modified++;
      }
    }

    return { branch, ahead, behind, staged, modified, untracked };
  } catch {
    return null;
  }
}

export function GitStatus({ cwd }: Props) {
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  useEffect(() => {
    const info = getGitInfo(cwd);
    setGitInfo(info);

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      setGitInfo(getGitInfo(cwd));
    }, 30000);

    return () => clearInterval(interval);
  }, [cwd]);

  if (!gitInfo) {
    return null;
  }

  const { branch, ahead, behind, staged, modified, untracked } = gitInfo;
  const hasChanges = staged > 0 || modified > 0 || untracked > 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color="white">Git </Text>
        <Text color="cyan">{branch}</Text>
        {ahead > 0 && <Text color="green"> ↑{ahead}</Text>}
        {behind > 0 && <Text color="yellow"> ↓{behind}</Text>}
      </Box>
      {hasChanges && (
        <Box>
          {staged > 0 && <Text color="green">+{staged} staged </Text>}
          {modified > 0 && <Text color="yellow">~{modified} modified </Text>}
          {untracked > 0 && <Text dimColor>?{untracked} untracked</Text>}
        </Box>
      )}
    </Box>
  );
}
