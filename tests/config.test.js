import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, getConfigPath } from '../dist/config.js';
import * as path from 'node:path';
import * as os from 'node:os';

test('loadConfig returns valid config structure', async () => {
  const config = await loadConfig();

  // pathLevels must be 1, 2, or 3
  assert.ok([1, 2, 3].includes(config.pathLevels), 'pathLevels should be 1, 2, or 3');

  // layout must be valid
  const validLayouts = ['default', 'condensed', 'separators'];
  assert.ok(validLayouts.includes(config.layout), 'layout should be valid');

  // gitStatus object with expected properties
  assert.equal(typeof config.gitStatus, 'object');
  assert.equal(typeof config.gitStatus.enabled, 'boolean');
  assert.equal(typeof config.gitStatus.showDirty, 'boolean');
  assert.equal(typeof config.gitStatus.showAheadBehind, 'boolean');

  // display object with expected properties
  assert.equal(typeof config.display, 'object');
  assert.equal(typeof config.display.showModel, 'boolean');
  assert.equal(typeof config.display.showContextBar, 'boolean');
  assert.equal(typeof config.display.showConfigCounts, 'boolean');
  assert.equal(typeof config.display.showDuration, 'boolean');
  assert.equal(typeof config.display.showTokenBreakdown, 'boolean');
  assert.equal(typeof config.display.showUsage, 'boolean');
  assert.equal(typeof config.display.showTools, 'boolean');
  assert.equal(typeof config.display.showAgents, 'boolean');
  assert.equal(typeof config.display.showTodos, 'boolean');
});

test('getConfigPath returns correct path', () => {
  const configPath = getConfigPath();
  const homeDir = os.homedir();
  assert.equal(configPath, path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json'));
});
