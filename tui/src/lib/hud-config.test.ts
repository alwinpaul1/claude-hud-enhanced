import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readHudConfig, readHudConfigWithStatus } from './hud-config.js';

describe('readHudConfig', () => {
  it('filters invalid panel IDs and reads width', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        panelOrder: ['status', 'tools', 'bogus'],
        hiddenPanels: ['cost', 'nope'],
        width: 52,
      }),
      'utf-8',
    );

    const config = readHudConfig(configPath);
    expect(config?.panelOrder).toEqual(['status', 'tools']);
    expect(config?.hiddenPanels).toEqual(['cost']);
    expect(config?.width).toBe(52);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an error status for invalid JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, '{not json}', 'utf-8');

    const result = readHudConfigWithStatus(configPath);
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
