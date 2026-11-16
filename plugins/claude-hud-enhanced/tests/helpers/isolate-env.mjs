import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const guardPath = fileURLToPath(new URL('./fs-guard.cjs', import.meta.url));

function detectRealHome() {
  try {
    return userInfo().homedir;
  } catch {
    return process.env.HOME ?? process.env.USERPROFILE ?? '';
  }
}

function writeGhStub(binDir, logPath) {
  mkdirSync(binDir, { recursive: true });
  const posix = path.join(binDir, 'gh');
  writeFileSync(posix, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${logPath}'\nexit 1\n`);
  chmodSync(posix, 0o755);
  writeFileSync(path.join(binDir, 'gh.cmd'), `@echo off\r\necho %* >> "${logPath}"\r\nexit /b 1\r\n`);
  const keychain = path.join(binDir, 'security');
  writeFileSync(keychain, '#!/bin/sh\nexit 44\n');
  chmodSync(keychain, 0o755);
}

function isolate() {
  if (process.env.HUD_TEST_ROOT && existsSync(process.env.HUD_TEST_ROOT)) {
    return {
      root: process.env.HUD_TEST_ROOT,
      home: process.env.HOME ?? '',
      realHome: process.env.HUD_TEST_REAL_HOME ?? '',
      ghLog: process.env.HUD_TEST_GH_LOG ?? '',
      guardLog: process.env.HUD_TEST_GUARD_LOG ?? '',
      owned: false,
    };
  }

  const realHome = detectRealHome();
  const realConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  const root = mkdtempSync(path.join(tmpdir(), 'claude-hud-test-env-'));
  const home = path.join(root, 'home');
  const binDir = path.join(root, 'bin');
  const ghLog = path.join(root, 'gh-calls.log');
  const guardLog = path.join(root, 'fs-guard.log');
  mkdirSync(home, { recursive: true });
  writeGhStub(binDir, ghLog);

  process.env.HUD_TEST_ROOT = root;
  process.env.HUD_TEST_REAL_HOME = realHome;
  process.env.HUD_TEST_REAL_CONFIG_DIRS = realConfigDir ? path.resolve(realConfigDir) : '';
  process.env.HUD_TEST_GH_LOG = ghLog;
  process.env.HUD_TEST_GUARD_LOG = guardLog;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_HUD_DISABLE;
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ''}`;
  process.env.GIT_CONFIG_GLOBAL = path.join(home, '.gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_TERMINAL_PROMPT = '0';
  writeFileSync(
    process.env.GIT_CONFIG_GLOBAL,
    '[user]\n\tname = HUD Test\n\temail = hud-test@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n',
  );
  const requireFlag = `--require=${JSON.stringify(guardPath)}`;
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, requireFlag].filter(Boolean).join(' ');

  return { root, home, realHome, ghLog, guardLog, owned: true };
}

const env = isolate();
const guard = require(guardPath);

export const testRoot = env.root;
export const testHome = env.home;
export const realHomeDir = env.realHome;
export const ghCallsLog = env.ghLog;
export const fsGuardLog = env.guardLog;

export function readGuardViolations() {
  const logged = env.guardLog && existsSync(env.guardLog) ? readFileSync(env.guardLog, 'utf8').trim() : '';
  return [...guard.violations, ...(logged ? [logged] : [])];
}

export function readGhCalls() {
  return env.ghLog && existsSync(env.ghLog) ? readFileSync(env.ghLog, 'utf8').split('\n').filter(Boolean) : [];
}

if (env.owned) {
  process.on('exit', () => {
    const violations = readGuardViolations();
    if (violations.length > 0) {
      process.stderr.write(`\n[fs-guard] the real Claude config dir was touched by this test file:\n${violations.join('\n')}\n`);
      process.exitCode = 1;
    }
    try {
      rmSync(env.root, { recursive: true, force: true });
    } catch {
      process.exitCode = process.exitCode || 0;
    }
  });
}
