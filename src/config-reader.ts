import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ConfigCounts {
  claudeMdCount: number;
  rulesCount: number;
  mcpCount: number;
  hooksCount: number;
}

export async function countConfigs(cwd?: string): Promise<ConfigCounts> {
  let claudeMdCount = 0;
  let rulesCount = 0;
  let mcpCount = 0;
  let hooksCount = 0;

  const claudeDir = path.join(os.homedir(), '.claude');
  const globalRulesDir = path.join(claudeDir, 'rules');
  const settingsPath = path.join(claudeDir, 'settings.json');

  if (fs.existsSync(path.join(claudeDir, 'CLAUDE.md'))) {
    claudeMdCount++;
  }

  if (fs.existsSync(globalRulesDir)) {
    try {
      const files = fs.readdirSync(globalRulesDir);
      rulesCount += files.filter((f) => f.endsWith('.md')).length;
    } catch {
      // Ignore errors
    }
  }

  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(content);

      if (settings.mcpServers && typeof settings.mcpServers === 'object') {
        mcpCount += Object.keys(settings.mcpServers).length;
      }

      if (settings.hooks && typeof settings.hooks === 'object') {
        hooksCount += Object.keys(settings.hooks).length;
      }
    } catch {
      // Ignore errors
    }
  }

  if (cwd) {
    if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) {
      claudeMdCount++;
    }

    const projectRulesDir = path.join(cwd, '.claude', 'rules');
    if (fs.existsSync(projectRulesDir)) {
      try {
        const files = fs.readdirSync(projectRulesDir);
        rulesCount += files.filter((f) => f.endsWith('.md')).length;
      } catch {
        // Ignore errors
      }
    }

    const projectSettingsPath = path.join(cwd, '.claude', 'settings.json');
    if (fs.existsSync(projectSettingsPath)) {
      try {
        const content = fs.readFileSync(projectSettingsPath, 'utf8');
        const settings = JSON.parse(content);

        if (settings.mcpServers && typeof settings.mcpServers === 'object') {
          mcpCount += Object.keys(settings.mcpServers).length;
        }

        if (settings.hooks && typeof settings.hooks === 'object') {
          hooksCount += Object.keys(settings.hooks).length;
        }
      } catch {
        // Ignore errors
      }
    }
  }

  return { claudeMdCount, rulesCount, mcpCount, hooksCount };
}

