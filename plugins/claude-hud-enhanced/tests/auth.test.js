import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { deriveAuthInfo, readAuthInfo, truncateUser, formatAuthSegment } from '../dist/auth.js';

const MAX_ACCOUNT = {
  oauthAccount: {
    emailAddress: 'someone.long@example.com',
    displayName: 'Some One',
    organizationType: 'claude_max',
    organizationRateLimitTier: 'default_claude_max_20x',
  },
};

function restoreEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test('deriveAuthInfo formats claude_max with rate-limit tier', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, {});
  assert.equal(info.method, 'Claude Max 20x');
  assert.equal(info.user, 'someone.long');
});

test('deriveAuthInfo formats claude_pro without tier', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      emailAddress: 'a@b.com',
      organizationType: 'claude_pro',
      organizationRateLimitTier: 'default_claude_pro',
    },
  }, {});
  assert.equal(info.method, 'Claude Pro');
  assert.equal(info.user, 'a');
});

test('deriveAuthInfo falls back to displayName without email', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      displayName: 'Some One',
      organizationType: 'claude_enterprise',
    },
  }, {});
  assert.equal(info.method, 'Claude Enterprise');
  assert.equal(info.user, 'Some One');
});

test('deriveAuthInfo reports API Key when no oauth account but key exported', () => {
  const info = deriveAuthInfo({}, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.equal(info.method, 'API Key');
  assert.equal(info.user, null);
});

test('deriveAuthInfo gives API Key precedence over a stale oauth account', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, { ANTHROPIC_API_KEY: 'sk-test' });
  assert.deepEqual(info, { method: 'API Key', user: null });
});

test('deriveAuthInfo returns nulls for missing/invalid input', () => {
  assert.deepEqual(deriveAuthInfo(null, {}), { method: null, user: null });
  assert.deepEqual(deriveAuthInfo('junk', {}), { method: null, user: null });
  assert.deepEqual(deriveAuthInfo({ oauthAccount: 42 }, {}), { method: null, user: null });
});

test('deriveAuthInfo strips ANSI sequences and control characters from values', () => {
  const info = deriveAuthInfo({
    oauthAccount: {
      emailAddress: 'evil\x1b[31m@example.com',
      organizationType: 'claude_max',
    },
  }, {});
  assert.equal(info.user, 'evil');
});

test('readAuthInfo honors CLAUDE_CONFIG_DIR and handles unreadable profiles', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-auth-test-'));
  const configDir = path.join(tempDir, 'profile');
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;

    assert.deepEqual(readAuthInfo(), { method: null, user: null });

    await writeFile(`${configDir}.json`, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });

    await writeFile(`${configDir}.json`, '{invalid', 'utf8');
    assert.deepEqual(readAuthInfo(), { method: null, user: null });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    restoreEnvVar('ANTHROPIC_API_KEY', originalApiKey);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('readAuthInfo reports an API key without requiring an oauth profile', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'claude-hud-auth-key-test-'));
  const originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  try {
    process.env.CLAUDE_CONFIG_DIR = path.join(tempDir, 'missing');
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    assert.deepEqual(readAuthInfo(), { method: 'API Key', user: null });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', originalConfigDir);
    restoreEnvVar('ANTHROPIC_API_KEY', originalApiKey);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('truncateUser truncates with ellipsis and honors 0 = full', () => {
  assert.equal(truncateUser('yukinoshita.reimu', 8), 'yukinosh…');
  assert.equal(truncateUser('short', 8), 'short');
  assert.equal(truncateUser('yukinoshita.reimu', 0), 'yukinoshita.reimu');
});

test('formatAuthSegment joins method and truncated user', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, {});
  // Explicit empty env keeps this independent of any ambient CLAUDE_CODE_USE_*.
  assert.equal(
    formatAuthSegment(info, { showAuth: true, showAuthUser: true, authUserLength: 8 }, {}),
    'Claude Max 20x · someone.…',
  );
  assert.equal(
    formatAuthSegment(info, { showAuth: true, showAuthUser: false }, {}),
    'Claude Max 20x',
  );
  assert.equal(
    formatAuthSegment(info, { showAuth: false, showAuthUser: true, authUserLength: 0 }, {}),
    'someone.long',
  );
  assert.equal(formatAuthSegment(info, { showAuth: false, showAuthUser: false }, {}), null);
  assert.equal(formatAuthSegment(null, { showAuth: true, showAuthUser: true }, {}), null);
});

// --- derived-auth caching -------------------------------------------------
// claude.json is the user's entire CLI config and grows with project history.
// The status line runs on every interaction, so an uncached parse is paid per
// tick. These tests exist because a cache that silently does nothing is still
// CORRECT, just slow -- a performance property with no test regresses unnoticed.

test('readAuthInfo caches derived auth and serves it on an unchanged file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-cache-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;   // force the file path
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');

    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud-enhanced', 'auth-cache', 'auth.json');
    assert.ok(fsSync.existsSync(cacheFile), 'first read must write a cache entry');

    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });
    assert.equal(fsSync.statSync(path.dirname(cacheFile)).mode & 0o777, 0o700);
    assert.equal(fsSync.statSync(cacheFile).mode & 0o777, 0o600);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo re-parses when claude.json actually changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-bust-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    await writeFile(jsonPath, JSON.stringify({
      oauthAccount: { emailAddress: 'other@example.com', organizationType: 'claude_pro' },
    }), 'utf8');
    const future = new Date(Date.now() + 5000);
    fsSync.utimesSync(jsonPath, future, future);

    assert.equal(readAuthInfo().user, 'other', 'a changed file must bust the cache');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

// The cache key is a composite identity over every candidate config file. Any
// change to the identity string must bust it. Forged by reading the real v2
// entry the plugin just wrote and corrupting only its identity, so the test
// stays independent of the exact identity format.
test('readAuthInfo busts the cache when the source identity changes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-identity-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long', 'seed the cache');

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud-enhanced', 'auth-cache', 'auth.json');
    const entry = JSON.parse(fsSync.readFileSync(cacheFile, 'utf8'));
    assert.equal(entry.version, 2);
    assert.equal(typeof entry.identity, 'string');
    entry.identity = `${entry.identity}#stale`;
    entry.method = 'STALE';
    entry.user = 'stale-user';
    fsSync.writeFileSync(cacheFile, JSON.stringify(entry), 'utf8');

    assert.equal(readAuthInfo().user, 'someone.long',
      'a changed identity must bust the cache and re-parse');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

// A v1 entry (the pre-composite-identity schema) must be rejected outright, so
// an upgraded plugin never trusts a cache the old code wrote.
test('readAuthInfo rejects a stale v1 cache entry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-v1-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long', 'seed a real cache first');

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud-enhanced', 'auth-cache', 'auth.json');
    const stat = fsSync.statSync(jsonPath);
    fsSync.writeFileSync(cacheFile, JSON.stringify({
      version: 1,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      size: stat.size,
      dev: stat.dev,
      ino: stat.ino,
      method: 'STALE',
      user: 'stale-user',
    }), 'utf8');

    assert.equal(readAuthInfo().user, 'someone.long',
      'a v1 entry must be rejected and re-parsed under v2');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo rejects a poisoned cache even when source identity matches', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-poison-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    await writeFile(jsonPath, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    // Keep the real identity so the entry WOULD be served, then poison only the
    // rendered values: the sanitizer must still reject them and re-parse.
    const cacheFile = path.join(configDir, 'plugins', 'claude-hud-enhanced', 'auth-cache', 'auth.json');
    const entry = JSON.parse(fsSync.readFileSync(cacheFile, 'utf8'));
    entry.method = 'Max\x1b[31m';
    entry.user = 'attacker\x1b]8;;https://evil.test\x07link\x1b]8;;\x07';
    fsSync.writeFileSync(cacheFile, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600 });

    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

// --- config-file resolution (the reported bug) ---------------------------
// A default profile can carry an empty inside stub `~/.claude/.claude.json`
// (migration flags, no oauthAccount) while the real account lives in the
// sibling `~/.claude.json`. The stub must NOT shadow the account.

test('readAuthInfo skips an empty inside stub and resolves the account from the sibling', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-shadow-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    // Empty stub INSIDE the dir (mirrors the file that shadowed the account).
    await writeFile(path.join(configDir, '.claude.json'),
      JSON.stringify({ mcpServers: {}, migrationVersion: 13 }), 'utf8');
    // Real account in the SIBLING.
    await writeFile(`${configDir}.json`, JSON.stringify(MAX_ACCOUNT), 'utf8');

    assert.deepEqual(readAuthInfo(), { method: 'Claude Max 20x', user: 'someone.long' });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo prefers the inside account over a sibling for a custom profile', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-inside-'));
  const configDir = path.join(dir, 'work');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    // Custom-profile layout: the real account is INSIDE.
    await writeFile(path.join(configDir, '.claude.json'), JSON.stringify({
      oauthAccount: { emailAddress: 'w@team.co', organizationType: 'claude_team', organizationRateLimitTier: 'default_raven' },
    }), 'utf8');
    // A different sibling account must NOT win over the inside one.
    await writeFile(`${configDir}.json`, JSON.stringify(MAX_ACCOUNT), 'utf8');

    assert.deepEqual(readAuthInfo(), { method: 'Claude Team', user: 'w' });
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

// --- cloud-provider suppression (Bedrock/Vertex) -------------------------
// A leftover claude.ai plan must not render beside the provider label when the
// active credential is a cloud IAM identity.

test('deriveAuthInfo formats claude_team and short label strips "Claude"', () => {
  const info = deriveAuthInfo({
    oauthAccount: { emailAddress: 'a@team.co', organizationType: 'claude_team', organizationRateLimitTier: 'default_raven' },
  }, {});
  assert.equal(info.method, 'Claude Team');
  assert.equal(formatAuthSegment(info, { showAuth: true, authShortLabel: true }, {}), 'Team');
});

test('formatAuthSegment suppresses the plan under Bedrock and Vertex', () => {
  const info = deriveAuthInfo(MAX_ACCOUNT, {});
  assert.equal(formatAuthSegment(info, { showAuth: true }, { CLAUDE_CODE_USE_BEDROCK: '1' }), null);
  assert.equal(
    formatAuthSegment(info, { showAuth: true, showAuthUser: true }, { CLAUDE_CODE_USE_VERTEX: '1' }),
    null,
  );
  // No cloud provider (and the flag set to something other than '1') → normal label.
  assert.equal(formatAuthSegment(info, { showAuth: true, authShortLabel: true }, {}), 'Max 20x');
  assert.equal(
    formatAuthSegment(info, { showAuth: true, authShortLabel: true }, { CLAUDE_CODE_USE_BEDROCK: '0' }),
    'Max 20x',
  );
});

test('readAuthInfo rejects symlink cache files without touching their target', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-symlink-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    await writeFile(`${configDir}.json`, JSON.stringify(MAX_ACCOUNT), 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    const cacheFile = path.join(configDir, 'plugins', 'claude-hud-enhanced', 'auth-cache', 'auth.json');
    const target = path.join(dir, 'target.json');
    await writeFile(target, 'do-not-touch', 'utf8');
    fsSync.unlinkSync(cacheFile);
    fsSync.symlinkSync(target, cacheFile);

    assert.equal(readAuthInfo().user, 'someone.long');
    assert.equal(fsSync.readFileSync(target, 'utf8'), 'do-not-touch');
    assert.equal(fsSync.lstatSync(cacheFile).isSymbolicLink(), false);
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});

test('readAuthInfo detects same-size rewrites with a restored mtime', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hud-auth-ctime-'));
  const configDir = path.join(dir, '.claude');
  const original = process.env.CLAUDE_CONFIG_DIR;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const fsSync = await import('node:fs');

  try {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    fsSync.mkdirSync(configDir, { recursive: true });
    const jsonPath = `${configDir}.json`;
    const first = JSON.stringify(MAX_ACCOUNT);
    const second = first.replace('someone.long', 'another.long');
    assert.equal(first.length, second.length);
    await writeFile(jsonPath, first, 'utf8');
    assert.equal(readAuthInfo().user, 'someone.long');

    const originalStat = fsSync.statSync(jsonPath);
    await writeFile(jsonPath, second, 'utf8');
    fsSync.utimesSync(jsonPath, originalStat.atime, originalStat.mtime);

    assert.equal(readAuthInfo().user, 'another.long');
  } finally {
    restoreEnvVar('CLAUDE_CONFIG_DIR', original);
    restoreEnvVar('ANTHROPIC_API_KEY', originalKey);
    await rm(dir, { recursive: true, force: true });
  }
});
