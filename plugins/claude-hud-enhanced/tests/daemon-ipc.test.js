import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IPC_PROTOCOL_VERSION,
  MAX_FRAME_BYTES,
  encodeMessage,
  createLineDecoder,
  getIpcPath,
  getSpawnLockPath,
  getPluginVersion,
} from '../dist/daemon-ipc.js';

test('encode/decode round-trips messages, including newlines inside strings', () => {
  const messages = [];
  const feed = createLineDecoder((m) => messages.push(m));
  const original = { v: 1, output: 'line one\nline two\n\x1b[32mansi\x1b[0m', n: 42 };
  feed(encodeMessage(original));
  assert.deepEqual(messages, [original]);
});

test('decoder handles chunk splits and multiple messages per chunk', () => {
  const messages = [];
  const feed = createLineDecoder((m) => messages.push(m));
  const a = encodeMessage({ id: 'a' });
  const b = encodeMessage({ id: 'b' });
  const joined = a + b;
  // Feed byte-by-byte across an awkward boundary
  feed(joined.slice(0, 3));
  feed(joined.slice(3, a.length + 2));
  feed(joined.slice(a.length + 2));
  assert.deepEqual(messages, [{ id: 'a' }, { id: 'b' }]);
});

test('decoder surfaces malformed frames as null instead of hanging', () => {
  const messages = [];
  const feed = createLineDecoder((m) => messages.push(m));
  feed('this is not json\n');
  assert.deepEqual(messages, [null]);
});

test('decoder resets on oversized buffers', () => {
  const messages = [];
  const feed = createLineDecoder((m) => messages.push(m));
  feed('x'.repeat(MAX_FRAME_BYTES + 1));
  assert.deepEqual(messages, [null]);
  // Still functional afterwards
  feed(encodeMessage({ ok: true }));
  assert.deepEqual(messages, [null, { ok: true }]);
});

test('getIpcPath / getSpawnLockPath live under the per-profile HUD daemon dir', () => {
  const home = '/tmp/daemon-ipc-home';
  const base = path.join(home, '.claude', 'plugins', 'claude-hud-enhanced', 'daemon');
  assert.equal(getIpcPath(home), path.join(base, 'hud.sock'));
  assert.equal(getSpawnLockPath(home), path.join(base, 'hud.spawn.lock'));
});

test('getIpcPath: sun_path-length overflow falls back to a hashed 0700-able SUBDIR', () => {
  const longHome = '/tmp/' + 'x'.repeat(120);
  const origXdg = process.env.XDG_RUNTIME_DIR;
  try {
    // Branch 1: no XDG_RUNTIME_DIR → os.tmpdir()
    delete process.env.XDG_RUNTIME_DIR;
    const p1 = getIpcPath(longHome);
    assert.ok(p1.startsWith(os.tmpdir()), 'without XDG, fallback lives under os.tmpdir()');
    assert.match(p1, /claude-hud-[0-9a-f]{16}[/\\]hud\.sock$/, 'socket sits INSIDE a per-profile subdir (the access guard), not the shared root');
    assert.ok(Buffer.byteLength(p1, 'utf8') <= 104, 'fallback path stays inside sun_path limits');

    // Branch 2: XDG_RUNTIME_DIR set (Linux/CI norm) → preferred over tmpdir
    process.env.XDG_RUNTIME_DIR = '/tmp/xdg-rt-test';
    const p2 = getIpcPath(longHome);
    assert.ok(p2.startsWith('/tmp/xdg-rt-test/'), 'XDG_RUNTIME_DIR wins when set');
    assert.match(p2, /claude-hud-[0-9a-f]{16}[/\\]hud\.sock$/);
  } finally {
    if (origXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = origXdg;
  }
});

test('getPluginVersion reads this package\'s own version', () => {
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
      'utf8',
    ),
  );
  assert.equal(getPluginVersion(), pkg.version);
  assert.equal(IPC_PROTOCOL_VERSION, 1);
});
