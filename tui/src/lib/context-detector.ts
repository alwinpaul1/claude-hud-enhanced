import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ContextFiles {
  globalClaudeMd: boolean;
  projectClaudeMd: boolean;
  projectClaudeMdPath: string | null;
  projectSettings: boolean;
  projectSettingsRules: number;
}

const GLOBAL_CLAUDE_MD = path.join(os.homedir(), '.claude', 'CLAUDE.md');

export function detectContextFiles(cwd?: string): ContextFiles {
  const result: ContextFiles = {
    globalClaudeMd: false,
    projectClaudeMd: false,
    projectClaudeMdPath: null,
    projectSettings: false,
    projectSettingsRules: 0,
  };

  try {
    result.globalClaudeMd = fs.existsSync(GLOBAL_CLAUDE_MD);
  } catch {
    // Ignore errors
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
    } catch {
      // Ignore errors
    }
  }

  const projectSettingsPath = path.join(cwd, '.claude', 'settings.json');
  try {
    if (fs.existsSync(projectSettingsPath)) {
      result.projectSettings = true;
      const content = fs.readFileSync(projectSettingsPath, 'utf-8');
      const settings = JSON.parse(content);
      if (settings.permissions?.allow) {
        result.projectSettingsRules = settings.permissions.allow.length;
      }
    }
  } catch {
    // Ignore errors
  }

  return result;
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
