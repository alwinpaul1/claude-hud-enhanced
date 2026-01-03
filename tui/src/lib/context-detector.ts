import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from './logger.js';

export interface ContextFiles {
  globalClaudeMd: boolean;
  projectClaudeMd: boolean;
  projectClaudeMdPath: string | null;
  rulesCount: number;
}

function getHomeDir(): string {
  return process.env.HOME || os.homedir();
}

export function detectContextFiles(cwd?: string): ContextFiles {
  const result: ContextFiles = {
    globalClaudeMd: false,
    projectClaudeMd: false,
    projectClaudeMdPath: null,
    rulesCount: 0,
  };

  const homeDir = getHomeDir();
  const globalClaudeMdPath = path.join(homeDir, '.claude', 'CLAUDE.md');
  const globalRulesDir = path.join(homeDir, '.claude', 'rules');

  try {
    result.globalClaudeMd = fs.existsSync(globalClaudeMdPath);
  } catch (err) {
    logger.debug('ContextDetector', 'Failed to check global CLAUDE.md', { err });
  }

  if (!cwd) {
    return result;
  }

  const projectClaudeMdPaths = [
    path.join(cwd, '.claude', 'CLAUDE.md'),
    path.join(cwd, 'CLAUDE.md'),
  ];

  for (const p of projectClaudeMdPaths) {
    try {
      if (fs.existsSync(p)) {
        result.projectClaudeMd = true;
        result.projectClaudeMdPath = p;
        break;
      }
    } catch (err) {
      logger.debug('ContextDetector', 'Failed to check project CLAUDE.md', { path: p, err });
    }
  }

  const projectRulesPath = path.join(cwd, '.claude', 'rules');
  result.rulesCount = countRules(globalRulesDir) + countRules(projectRulesPath);

  return result;
}

function countRules(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) {
      return 0;
    }
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.')).length;
  } catch (err) {
    logger.debug('ContextDetector', 'Failed to read rules directory', {
      path: dirPath,
      err,
    });
    return 0;
  }
}

export class ContextDetector {
  private data: ContextFiles | null = null;
  private lastCwd: string | undefined;
  private lastRead: number = 0;
  private readonly refreshInterval = 30000;

  detect(cwd?: string): ContextFiles {
    const now = Date.now();
    const cwdChanged = cwd !== this.lastCwd;

    if (!this.data || cwdChanged || now - this.lastRead > this.refreshInterval) {
      this.data = detectContextFiles(cwd);
      this.lastCwd = cwd;
      this.lastRead = now;
    }
    return this.data;
  }

  forceRefresh(cwd?: string): ContextFiles {
    this.data = detectContextFiles(cwd);
    this.lastCwd = cwd;
    this.lastRead = Date.now();
    return this.data;
  }
}
