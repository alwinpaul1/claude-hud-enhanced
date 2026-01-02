import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readSettings, SettingsReader } from './settings-reader.js';

describe('readSettings', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    settingsPath = path.join(tmpDir, '.claude', 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when settings file is missing', async () => {
    expect(readSettings(settingsPath)).toBeNull();
  });

  it('parses plugin and MCP settings', async () => {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        model: 'claude-sonnet-4',
        enabledPlugins: {
          'plugin-a@1.0.0': true,
          'plugin-b': false,
          'plugin-c@2.0.0': true,
        },
        mcpServers: {
          'server-a': { type: 'sse', url: 'http://localhost' },
        },
        permissions: { allow: ['shell_command'] },
      }),
      'utf-8',
    );

    const data = readSettings(settingsPath);

    expect(data).not.toBeNull();
    expect(data?.model).toBe('claude-sonnet-4');
    expect(data?.pluginCount).toBe(2);
    expect(data?.pluginNames).toEqual(['plugin-a', 'plugin-c']);
    expect(data?.mcpCount).toBe(1);
    expect(data?.mcpNames).toEqual(['server-a']);
    expect(data?.allowedPermissions).toEqual(['shell_command']);
  });
});

describe('SettingsReader', () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses cached data until forceRefresh is called', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ model: 'alpha', enabledPlugins: {} }),
      'utf-8',
    );

    const reader = new SettingsReader(settingsPath);

    const first = reader.read();
    expect(first?.model).toBe('alpha');

    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ model: 'beta', enabledPlugins: {} }),
      'utf-8',
    );

    const cached = reader.read();
    expect(cached?.model).toBe('alpha');

    const refreshed = reader.forceRefresh();
    expect(refreshed?.model).toBe('beta');
  });
});
