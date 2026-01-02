import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ClaudeSettings {
  model: string;
  enabledPlugins: Record<string, boolean>;
  mcpServers: Record<string, { type: string; url: string }>;
  permissions: { allow: string[] };
}

export interface SettingsData {
  model: string;
  pluginCount: number;
  pluginNames: string[];
  mcpCount: number;
  mcpNames: string[];
  allowedPermissions: string[];
}

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

export function readSettings(settingsPath: string = SETTINGS_PATH): SettingsData | null {
  try {
    if (!fs.existsSync(settingsPath)) {
      return null;
    }
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings: ClaudeSettings = JSON.parse(content);

    const enabledPlugins = Object.entries(settings.enabledPlugins || {})
      .filter(([, enabled]) => enabled)
      .map(([name]) => name.split('@')[0]);

    const mcpNames = Object.keys(settings.mcpServers || {});

    return {
      model: settings.model || 'unknown',
      pluginCount: enabledPlugins.length,
      pluginNames: enabledPlugins,
      mcpCount: mcpNames.length,
      mcpNames,
      allowedPermissions: settings.permissions?.allow || [],
    };
  } catch {
    return null;
  }
}

export class SettingsReader {
  private data: SettingsData | null = null;
  private lastRead: number = 0;
  private readonly refreshInterval = 30000;
  private readonly settingsPath: string;

  constructor(settingsPath: string = SETTINGS_PATH) {
    this.settingsPath = settingsPath;
  }

  read(): SettingsData | null {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      this.data = readSettings(this.settingsPath);
      this.lastRead = now;
    }
    return this.data;
  }

  forceRefresh(): SettingsData | null {
    this.data = readSettings(this.settingsPath);
    this.lastRead = Date.now();
    return this.data;
  }
}
