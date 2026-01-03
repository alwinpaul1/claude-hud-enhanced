import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from './logger.js';

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

export interface SettingsReadResult {
  data: SettingsData | null;
  error?: string;
}

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function buildSettingsData(settings: ClaudeSettings): SettingsData {
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
}

export function readSettingsWithStatus(settingsPath: string = SETTINGS_PATH): SettingsReadResult {
  try {
    if (!fs.existsSync(settingsPath)) {
      return { data: null };
    }
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings: ClaudeSettings = JSON.parse(content);
    return { data: buildSettingsData(settings) };
  } catch (err) {
    logger.debug('SettingsReader', 'Failed to read settings', { path: settingsPath, err });
    return { data: null, error: 'Failed to read settings.json' };
  }
}

export async function readSettingsWithStatusAsync(
  settingsPath: string = SETTINGS_PATH,
): Promise<SettingsReadResult> {
  try {
    const content = await fs.promises.readFile(settingsPath, 'utf-8');
    const settings: ClaudeSettings = JSON.parse(content);
    return { data: buildSettingsData(settings) };
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      return { data: null };
    }
    logger.debug('SettingsReader', 'Failed to read settings', { path: settingsPath, err });
    return { data: null, error: 'Failed to read settings.json' };
  }
}

export function readSettings(settingsPath: string = SETTINGS_PATH): SettingsData | null {
  return readSettingsWithStatus(settingsPath).data;
}

export async function readSettingsAsync(
  settingsPath: string = SETTINGS_PATH,
): Promise<SettingsData | null> {
  const result = await readSettingsWithStatusAsync(settingsPath);
  return result.data;
}

export class SettingsReader {
  private data: SettingsData | null = null;
  private lastError: string | undefined;
  private lastRead: number = 0;
  private readonly refreshInterval = 30000;
  private readonly settingsPath: string;

  constructor(settingsPath: string = SETTINGS_PATH) {
    this.settingsPath = settingsPath;
  }

  read(): SettingsData | null {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      const result = readSettingsWithStatus(this.settingsPath);
      this.data = result.data;
      this.lastError = result.error;
      this.lastRead = now;
    }
    return this.data;
  }

  readWithStatus(): SettingsReadResult {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      const result = readSettingsWithStatus(this.settingsPath);
      this.data = result.data;
      this.lastError = result.error;
      this.lastRead = now;
      return result;
    }
    return { data: this.data, error: this.lastError };
  }

  async readWithStatusAsync(): Promise<SettingsReadResult> {
    const now = Date.now();
    if (!this.data || now - this.lastRead > this.refreshInterval) {
      const result = await readSettingsWithStatusAsync(this.settingsPath);
      this.data = result.data;
      this.lastError = result.error;
      this.lastRead = now;
      return result;
    }
    return { data: this.data, error: this.lastError };
  }

  forceRefresh(): SettingsData | null {
    const result = readSettingsWithStatus(this.settingsPath);
    this.data = result.data;
    this.lastError = result.error;
    this.lastRead = Date.now();
    return this.data;
  }

  async forceRefreshAsync(): Promise<SettingsData | null> {
    const result = await readSettingsWithStatusAsync(this.settingsPath);
    this.data = result.data;
    this.lastError = result.error;
    this.lastRead = Date.now();
    return this.data;
  }
}
