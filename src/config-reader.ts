import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export async function countRules(cwd?: string): Promise<number> {
  let count = 0;

  const claudeDir = path.join(os.homedir(), '.claude');
  const globalRulesDir = path.join(claudeDir, 'rules');

  if (fs.existsSync(path.join(claudeDir, 'CLAUDE.md'))) {
    count++;
  }

  if (fs.existsSync(globalRulesDir)) {
    try {
      const files = fs.readdirSync(globalRulesDir);
      count += files.filter((f) => f.endsWith('.md')).length;
    } catch {
      // Ignore errors
    }
  }

  if (cwd) {
    if (fs.existsSync(path.join(cwd, 'CLAUDE.md'))) {
      count++;
    }

    const projectRulesDir = path.join(cwd, '.claude', 'rules');
    if (fs.existsSync(projectRulesDir)) {
      try {
        const files = fs.readdirSync(projectRulesDir);
        count += files.filter((f) => f.endsWith('.md')).length;
      } catch {
        // Ignore errors
      }
    }
  }

  return count;
}

export async function countMcpServers(): Promise<number> {
  let count = 0;

  const globalMcpPath = path.join(os.homedir(), '.claude', '.mcp.json');
  if (fs.existsSync(globalMcpPath)) {
    try {
      const content = fs.readFileSync(globalMcpPath, 'utf8');
      const config = JSON.parse(content);
      if (config.mcpServers && typeof config.mcpServers === 'object') {
        count += Object.keys(config.mcpServers).length;
      }
    } catch {
      // Ignore errors
    }
  }

  return count;
}
