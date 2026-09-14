import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { tryDaemonRender } from '../dist/daemon-client.js';
import { encodeMessage, createLineDecoder, getIpcPath, getPluginVersion } from '../dist/daemon-ipc.js';

const STDIN = { model: { display_name: 'T' }, cwd: '/tmp' };

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-dc-'));
  fs.mkdirSync(path.join(home, '.claude', 'plugins', 'claude-hud-enhanced', 'daemon'), {
    recursive: true,
  });
  // These sandbox homes are long enough to trigger the sun_path fallback
  // (socket in a hashed tmpdir SUBDIR). The real daemon creates that subdir
  // via ensurePrivateDir before listening; the raw stub servers here don't,
  // so pre-create it.
  fs.mkdirSync(path.dirname(getIpcPath(home)), { recursive: true, mode: 0o700 });
  return home;
}

/** Stub daemon: replies to each request line via `reply(request)`. */
function stubServer(socketPath, reply) {
  const server = net.createServer((socket) => {
    socket.on(
      'data',
      createLineDecoder((message) => {
        const res = reply(message);
        if (res !== undefined) socket.end(encodeMessage(res));
        // undefined → never respond (hang simulation)
      }),
    );
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve(server)));
}

test('happy path: returns the daemon output', async () => {
  const home = makeHome();
  const socketPath = getIpcPath(home);
  const server = await stubServer(socketPath, (req) => ({
    v: 1,
    pluginVersion: getPluginVersion(),
    output: `rendered:${req.stdin.model.display_name}`,
    willExit: false,
  }));
  const spawns = [];
  const out = await tryDaemonRender(STDIN, '/entry.js', {
    homeDir: home,
    spawnDaemon: (p) => spawns.push(p),
  });
  assert.equal(out, 'rendered:T');
  assert.deepEqual(spawns, [], 'no spawn when the daemon answered');
  server.close();
});

test('no daemon: returns null, cleans stale socket, spawns exactly once across racers', async () => {
  const home = makeHome();
  const socketPath = getIpcPath(home);
  fs.writeFileSync(socketPath, ''); // stale plain file where the socket should be
  const spawns = [];
  const deps = { homeDir: home, spawnDaemon: (p) => spawns.push(p) };
  const [a, b] = await Promise.all([
    tryDaemonRender(STDIN, '/entry.js', deps),
    tryDaemonRender(STDIN, '/entry.js', deps),
  ]);
  assert.equal(a, null);
  assert.equal(b, null);
  assert.equal(spawns.length, 1, 'spawn single-flight: exactly one racer spawns');
  assert.equal(spawns[0], '/entry.js');
  assert.equal(fs.existsSync(socketPath), false, 'stale socket removed');
});

test('slow daemon: returns null WITHOUT unlinking the live socket or spawning', async () => {
  const home = makeHome();
  const socketPath = getIpcPath(home);
  const server = await stubServer(socketPath, () => undefined); // accepts, never responds
  const spawns = [];
  const out = await tryDaemonRender(STDIN, '/entry.js', {
    homeDir: home,
    responseTimeoutMs: 120,
    spawnDaemon: (p) => spawns.push(p),
  });
  assert.equal(out, null);
  assert.deepEqual(spawns, [], 'live-but-slow daemon must not be respawned over');
  assert.equal(fs.existsSync(socketPath), true, 'live socket left alone');
  server.close();
});

test('starved client: a connect that outlives the connect timeout does NOT unlink the live socket or respawn', async () => {
  // The leak seen on 2026-09-14: a 16 GB Mac in swap thrash. The statusline
  // client is a fresh process that gets descheduled for longer than
  // CONNECT_TIMEOUT_MS between net.connect() and its next event-loop turn.
  // libuv runs the timers phase before the poll phase, so the connect timer
  // fires first even though the kernel completed the connect long ago. The
  // old client read that as "nothing is listening", rm'd the LIVE daemon's
  // socket and spawned another; the orphan idled 10 minutes. One per
  // minute (spawn lock) × 10 min = ~10 resident bun runtimes at all times.
  const home = makeHome();
  const socketPath = getIpcPath(home);
  const server = await stubServer(socketPath, () => undefined); // alive, never responds
  const { ino: liveIno } = fs.statSync(socketPath);
  const spawns = [];
  // Phase matters. net.connect() completes synchronously on a unix socket and
  // 'connect' is delivered from the POLL phase; the connect timer fires from
  // the TIMERS phase. Starting from the check phase (setImmediate) means the
  // loop's next stop after we unblock is timers, so the timer is guaranteed
  // to win — which is the starved-client order. Started from a timer callback
  // (as node:test does when the previous test ended on a timeout) the loop
  // would visit poll first and the test would quietly pass on old code.
  const pending = await new Promise((resolve) =>
    setImmediate(() => {
      const p = tryDaemonRender(STDIN, '/entry.js', {
        homeDir: home,
        connectTimeoutMs: 20,
        responseTimeoutMs: 200,
        spawnDaemon: (p) => spawns.push(p),
      });
      // Starve our own event loop past the connect timer. net.connect() has
      // already run synchronously inside tryDaemonRender.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
      resolve(p);
    }),
  );
  try {
    const out = await pending;
    assert.equal(out, null, 'renders inline this tick');
    assert.deepEqual(spawns, [], 'a slow connect is not evidence the daemon is dead');
    assert.equal(fs.existsSync(socketPath), true, 'live socket left alone');
    assert.equal(fs.statSync(socketPath).ino, liveIno, 'same socket, not a replacement');
  } finally {
    server.close();
  }
});

test('malformed daemon response: returns null (inline fallback)', async () => {
  const home = makeHome();
  const socketPath = getIpcPath(home);
  const server = await stubServer(socketPath, () => ({ nonsense: true }));
  const out = await tryDaemonRender(STDIN, '/entry.js', { homeDir: home, spawnDaemon: () => {} });
  assert.equal(out, null);
  server.close();
});
