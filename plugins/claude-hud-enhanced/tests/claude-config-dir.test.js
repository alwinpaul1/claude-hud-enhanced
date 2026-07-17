import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getHudPluginDir,
  migrateLegacyHudPluginDir,
  _setRenameSyncImplForTests,
  HUD_PLUGIN_DIRNAME,
  LEGACY_HUD_PLUGIN_DIRNAME,
} from '../dist/claude-config-dir.js';

async function exists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test('getHudPluginDir returns plugins/claude-hud-enhanced under CLAUDE_CONFIG_DIR', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hud-cfgdir-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = root;
  try {
    const dir = getHudPluginDir(path.join(root, 'home-unused'));
    assert.equal(dir, path.join(root, 'plugins', HUD_PLUGIN_DIRNAME));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    await rm(root, { recursive: true, force: true });
  }
});

test('migrate renames legacy claude-hud dir to claude-hud-enhanced', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hud-migrate-'));
  const legacy = path.join(root, 'plugins', LEGACY_HUD_PLUGIN_DIRNAME);
  const next = path.join(root, 'plugins', HUD_PLUGIN_DIRNAME);
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, 'config.json'), '{"lineLayout":"compact"}', 'utf8');

  migrateLegacyHudPluginDir(legacy, next);

  assert.equal(await exists(legacy), false);
  assert.equal(await exists(next), true);
  assert.equal(await readFile(path.join(next, 'config.json'), 'utf8'), '{"lineLayout":"compact"}');
  await rm(root, { recursive: true, force: true });
});

test('migrate copies missing config.json when both dirs exist', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hud-merge-'));
  const legacy = path.join(root, 'plugins', LEGACY_HUD_PLUGIN_DIRNAME);
  const next = path.join(root, 'plugins', HUD_PLUGIN_DIRNAME);
  await mkdir(legacy, { recursive: true });
  await mkdir(next, { recursive: true });
  await writeFile(path.join(legacy, 'config.json'), '{"showSeparators":true}', 'utf8');

  migrateLegacyHudPluginDir(legacy, next);

  assert.equal(await exists(legacy), true); // left in place when both exist
  assert.equal(await readFile(path.join(next, 'config.json'), 'utf8'), '{"showSeparators":true}');
  await rm(root, { recursive: true, force: true });
});

test('migrate falls back to copy+remove when rename fails (EXDEV)', async () => {
  // Cross-device rename (EXDEV) is unreachable without a second filesystem, so
  // inject a rename that throws to exercise the copy-then-remove-legacy path.
  const root = await mkdtemp(path.join(tmpdir(), 'hud-exdev-'));
  const legacy = path.join(root, 'plugins', LEGACY_HUD_PLUGIN_DIRNAME);
  const next = path.join(root, 'plugins', HUD_PLUGIN_DIRNAME);
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, 'config.json'), '{"from":"legacy"}', 'utf8');

  let renameCalls = 0;
  _setRenameSyncImplForTests(() => {
    renameCalls += 1;
    throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
  });
  try {
    migrateLegacyHudPluginDir(legacy, next);
  } finally {
    _setRenameSyncImplForTests(null);
  }

  assert.equal(renameCalls, 1); // the fallback was actually triggered
  assert.equal(await exists(legacy), false); // legacy removed after copy
  assert.equal(await exists(next), true);
  assert.equal(await readFile(path.join(next, 'config.json'), 'utf8'), '{"from":"legacy"}');
  await rm(root, { recursive: true, force: true });
});

test('migrate does not copy legacy statusline.mjs into enhanced dir', async () => {
  // The legacy launcher globs the old `claude-hud` plugin dir; copying it would
  // install a wrong-name launcher. Setup regenerates it fresh instead.
  const root = await mkdtemp(path.join(tmpdir(), 'hud-launcher-'));
  const legacy = path.join(root, 'plugins', LEGACY_HUD_PLUGIN_DIRNAME);
  const next = path.join(root, 'plugins', HUD_PLUGIN_DIRNAME);
  await mkdir(legacy, { recursive: true });
  await mkdir(next, { recursive: true });
  await writeFile(path.join(legacy, 'statusline.mjs'), '// legacy launcher (globs claude-hud)', 'utf8');
  await writeFile(path.join(legacy, 'config.json'), '{"from":"legacy"}', 'utf8');

  migrateLegacyHudPluginDir(legacy, next);

  assert.equal(await exists(path.join(next, 'statusline.mjs')), false);
  assert.equal(await readFile(path.join(next, 'config.json'), 'utf8'), '{"from":"legacy"}');
  await rm(root, { recursive: true, force: true });
});

test('migrate does not overwrite existing enhanced config.json', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hud-keep-'));
  const legacy = path.join(root, 'plugins', LEGACY_HUD_PLUGIN_DIRNAME);
  const next = path.join(root, 'plugins', HUD_PLUGIN_DIRNAME);
  await mkdir(legacy, { recursive: true });
  await mkdir(next, { recursive: true });
  await writeFile(path.join(legacy, 'config.json'), '{"from":"legacy"}', 'utf8');
  await writeFile(path.join(next, 'config.json'), '{"from":"enhanced"}', 'utf8');

  migrateLegacyHudPluginDir(legacy, next);

  assert.equal(await readFile(path.join(next, 'config.json'), 'utf8'), '{"from":"enhanced"}');
  await rm(root, { recursive: true, force: true });
});

test('getHudPluginDir auto-migrates legacy dir on access', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hud-auto-'));
  const legacy = path.join(root, 'plugins', LEGACY_HUD_PLUGIN_DIRNAME);
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, 'config.json'), '{}', 'utf8');
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = root;
  try {
    const dir = getHudPluginDir('/unused');
    assert.equal(dir, path.join(root, 'plugins', HUD_PLUGIN_DIRNAME));
    assert.equal(await exists(legacy), false);
    assert.equal(await exists(path.join(dir, 'config.json')), true);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    await rm(root, { recursive: true, force: true });
  }
});
