import { fsGuardLog, ghCallsLog, realHomeDir, testHome, testRoot } from './helpers/isolate-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClaudeConfigDir, getHudPluginDir } from '../dist/claude-config-dir.js';
import { getIpcPath } from '../dist/daemon-ipc.js';
import { getSnapshotPath } from '../dist/usage-snapshot.js';
import { prPaths } from '../dist/pr-status.js';

const testsDir = fileURLToPath(new URL('.', import.meta.url));
const inside = (child, parent) => path.resolve(child).startsWith(path.resolve(parent) + path.sep);

test('every test file isolates its environment before importing anything else', () => {
  const files = readdirSync(testsDir).filter((name) => name.endsWith('.test.js'));
  assert.ok(files.length > 40);
  for (const name of files) {
    const first = readFileSync(path.join(testsDir, name), 'utf8').split('\n')[0];
    assert.match(first, /^import .*'\.\/helpers\/isolate-env\.mjs';$/, `${name} must import ./helpers/isolate-env.mjs on its first line`);
  }
});

test('HOME is a temp dir and CLAUDE_CONFIG_DIR is unset whatever the caller exported', () => {
  assert.equal(process.env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(os.homedir(), testHome);
  assert.ok(inside(testHome, testRoot));
  assert.ok(inside(testRoot, os.tmpdir()) || inside(testRoot, path.resolve(os.tmpdir(), '..')));
  assert.notEqual(path.resolve(testHome), path.resolve(realHomeDir));
});

test('every HUD data path resolves inside the temp home', () => {
  const home = os.homedir();
  const request = { cwd: '/repo', session: '/transcript.jsonl' };
  const paths = [
    getClaudeConfigDir(home),
    getHudPluginDir(home),
    getSnapshotPath(home),
    prPaths(request, home).snapshot,
    ...(process.platform === 'win32' ? [] : [getIpcPath(home)]),
  ];
  for (const candidate of paths) {
    assert.ok(inside(candidate, testRoot) || inside(candidate, os.tmpdir()), candidate);
    assert.ok(!inside(candidate, path.join(realHomeDir, '.claude')), candidate);
    assert.ok(!path.resolve(candidate).startsWith(path.join(realHomeDir, '.claude')), candidate);
  }
});

function probe(source) {
  const log = path.join(mkdtempSync(path.join(testRoot, 'probe-')), 'guard.log');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, HUD_TEST_GUARD_LOG: log, REAL_HOME: realHomeDir },
    encoding: 'utf8',
  });
  return { ...result, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

test('the guard refuses reads and writes under the real Claude config dirs, in child processes too', () => {
  const attempts = [
    "import fs from 'node:fs'; fs.readFileSync(process.env.REAL_HOME + '/.claude/settings.json');",
    "import fs from 'node:fs'; fs.writeFileSync(process.env.REAL_HOME + '/.claude-work/plugins/claude-hud-enhanced/usage-snapshot.json', '{}');",
    "import fs from 'node:fs'; fs.mkdirSync(process.env.REAL_HOME + '/.claude/plugins/claude-hud-enhanced/pr-cache', { recursive: true });",
    "import { readdir } from 'node:fs/promises'; await readdir(process.env.REAL_HOME + '/.claude/plugins');",
    "import { rename } from 'node:fs/promises'; await rename(process.env.TMPDIR ?? '/tmp', process.env.REAL_HOME + '/.claude.json');",
    "import fs from 'node:fs'; fs.existsSync(process.env.REAL_HOME + '/.claude/plugins/claude-hud');",
  ];
  for (const source of attempts) {
    const result = probe(source);
    assert.notEqual(result.status, 0, source);
    assert.match(result.stderr, /\[fs-guard\] test touched the real Claude config dir/, source);
    assert.match(result.log, /^fs(\.promises)?\.\w+ /, source);
  }
  const allowed = probe("import fs from 'node:fs'; fs.readdirSync(process.env.HOME); fs.existsSync(process.env.REAL_HOME);");
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(allowed.log, '');
});

test('the guard refuses outbound network requests', () => {
  const result = probe("await fetch('https://api.anthropic.com/api/oauth/usage');");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[fs-guard\]/);
  assert.match(result.log, /^fetch api\.anthropic\.com/);
});

test('gh and the macOS keychain reader resolve to inert stubs', { skip: process.platform === 'win32' }, () => {
  for (const tool of ['gh', 'security']) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    assert.ok(inside(found, testRoot), `${tool} resolves to ${found}`);
  }
  const before = existsSync(ghCallsLog) ? readFileSync(ghCallsLog, 'utf8') : '';
  const call = spawnSync('gh', ['pr', 'view', '--json', 'number'], { encoding: 'utf8' });
  assert.equal(call.status, 1);
  assert.equal(call.stdout, '');
  assert.equal(readFileSync(ghCallsLog, 'utf8'), `${before}pr view --json number\n`);
  assert.notEqual(spawnSync('security', ['find-generic-password', '-s', 'x', '-w'], { encoding: 'utf8' }).status, 0);
});

test('this file itself tripped no guard', () => {
  assert.equal(existsSync(fsGuardLog) ? readFileSync(fsGuardLog, 'utf8') : '', '');
});
