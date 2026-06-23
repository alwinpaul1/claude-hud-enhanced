import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCacheDir, getKeychainServiceNames } from '../dist/oauth.js';
import * as path from 'node:path';
import * as os from 'node:os';

const LEGACY_KEYCHAIN_SERVICE_NAME = 'Claude Code-credentials';

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

// Regression tests for the account-bleed bug: when running under a non-default
// CLAUDE_CONFIG_DIR (e.g. a separate work profile), the HUD must read/write its
// OAuth plan cache and keychain entry scoped to THAT profile — never borrow the
// default/personal profile's plan tier.

test('getCacheDir honors CLAUDE_CONFIG_DIR (each profile gets its own cache)', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    const customDir = path.join(os.tmpdir(), 'hud-cache-test-config');
    process.env.CLAUDE_CONFIG_DIR = customDir;
    const expected = path.join(path.resolve(customDir), 'plugins', 'claude-hud');
    assert.equal(getCacheDir(), expected);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getCacheDir defaults to ~/.claude when CLAUDE_CONFIG_DIR is unset', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    delete process.env.CLAUDE_CONFIG_DIR;
    const expected = path.join(os.homedir(), '.claude', 'plugins', 'claude-hud');
    assert.equal(getCacheDir(), expected);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getKeychainServiceNames excludes the legacy/personal service for a non-default config dir', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(os.tmpdir(), 'hud-keychain-test-config');
    const names = getKeychainServiceNames();
    assert.ok(
      !names.includes(LEGACY_KEYCHAIN_SERVICE_NAME),
      `non-default profile must not fall back to the personal service; got ${JSON.stringify(names)}`,
    );
    assert.ok(
      names.some((n) => n.startsWith(`${LEGACY_KEYCHAIN_SERVICE_NAME}-`)),
      `expected a profile-scoped hashed service name; got ${JSON.stringify(names)}`,
    );
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});

test('getKeychainServiceNames uses the legacy service for the default config dir', () => {
  const original = process.env.CLAUDE_CONFIG_DIR;
  try {
    delete process.env.CLAUDE_CONFIG_DIR;
    const names = getKeychainServiceNames();
    assert.ok(
      names.includes(LEGACY_KEYCHAIN_SERVICE_NAME),
      `default profile should use the legacy service; got ${JSON.stringify(names)}`,
    );
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
  }
});
