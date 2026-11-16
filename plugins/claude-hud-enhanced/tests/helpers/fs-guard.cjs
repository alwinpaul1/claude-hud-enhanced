'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');

const MARK = Symbol.for('claude-hud-enhanced.test.fs-guard');

function realHome() {
  if (process.env.HUD_TEST_REAL_HOME) return process.env.HUD_TEST_REAL_HOME;
  try {
    return os.userInfo().homedir;
  } catch {
    return '';
  }
}

function install() {
  if (globalThis[MARK]) return globalThis[MARK];

  const home = realHome();
  const fold = (value) => (process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value);
  const homePrefix = home ? fold(path.join(path.resolve(home), '.claude')) : null;
  const extraRoots = (process.env.HUD_TEST_REAL_CONFIG_DIRS || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => fold(path.resolve(dir)));
  const logPath = process.env.HUD_TEST_GUARD_LOG || '';
  const appendFileSync = fs.appendFileSync;
  const violations = [];

  const toPath = (value) => {
    if (typeof value === 'string') return value;
    if (Buffer.isBuffer(value)) return value.toString();
    if (value instanceof URL && value.protocol === 'file:') {
      try {
        return require('node:url').fileURLToPath(value);
      } catch {
        return null;
      }
    }
    return null;
  };

  const isForbidden = (value) => {
    const raw = toPath(value);
    if (raw === null || raw === '') return false;
    const resolved = fold(path.resolve(raw));
    if (homePrefix && resolved.startsWith(homePrefix)) return true;
    return extraRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
  };

  const report = (name, target) => {
    const where = (new Error().stack || '').split('\n').slice(3, 9).join('\n');
    const line = `${name} ${toPath(target)}`;
    violations.push(line);
    if (logPath) {
      try {
        appendFileSync.call(fs, logPath, `${line}\n${where}\n\n`);
      } catch {
        violations.push(`could not write guard log ${logPath}`);
      }
    }
    const error = new Error(`[fs-guard] test touched the real Claude config dir: ${line}`);
    error.code = 'EACCES';
    return error;
  };

  const wrap = (owner, label) => {
    for (const name of Object.keys(owner)) {
      const original = owner[name];
      if (typeof original !== 'function' || /^[A-Z_]/.test(name) || name === 'promises') continue;
      const guarded = function (...args) {
        for (const arg of args.slice(0, 2)) {
          if (isForbidden(arg)) throw report(`${label}.${name}`, arg);
        }
        return original.apply(this, args);
      };
      Object.defineProperties(guarded, Object.getOwnPropertyDescriptors(original));
      owner[name] = guarded;
    }
  };

  wrap(fs, 'fs');
  wrap(fs.promises, 'fs.promises');
  syncBuiltinESMExports();

  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === 'function') {
    globalThis.fetch = function guardedFetch(input, init) {
      let host = '';
      try {
        host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).hostname;
      } catch {
        host = '';
      }
      if (!LOCAL_HOSTS.has(host)) return Promise.reject(report('fetch', String(host || input)));
      return originalFetch.call(this, input, init);
    };
  }

  const state = { violations, isForbidden };
  globalThis[MARK] = state;
  return state;
}

module.exports = install();
