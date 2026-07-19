import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { runDaemon } from '../dist/daemon.js';
import { encodeMessage, createLineDecoder, getPluginVersion } from '../dist/daemon-ipc.js';

const VERSION = getPluginVersion();

function tmpSocketPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hud-d-')), 'hud.sock');
}

async function waitForSocket(socketPath, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('daemon never started listening');
}

/** One request over a fresh connection; resolves with the parsed response. */
function sendRequest(socketPath, request, ms = 2000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('no response'));
    }, ms);
    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.on('connect', () => socket.write(encodeMessage(request)));
    socket.on(
      'data',
      createLineDecoder((m) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(m);
      }),
    );
  });
}

function makeRequest(overrides = {}) {
  return {
    v: 1,
    pluginVersion: VERSION,
    stdin: { model: { display_name: 'T' } },
    cwd: '/tmp',
    env: {},
    now: Date.now(),
    ...overrides,
  };
}

test('daemon serves requests through the injected handler', async () => {
  const socketPath = tmpSocketPath();
  const exits = [];
  runDaemon({
    socketPath,
    idleTimeoutMs: 800,
    handleRequest: async (req) => `echo:${req.stdin.model.display_name}`,
    exit: (code) => exits.push(code),
  });
  await waitForSocket(socketPath);

  const res = await sendRequest(socketPath, makeRequest());
  assert.equal(res.v, 1);
  assert.equal(res.output, 'echo:T');
  assert.equal(res.willExit, false);
  assert.deepEqual(exits, []);

  // Second request on a fresh connection also works (daemon stays up)
  const res2 = await sendRequest(socketPath, makeRequest());
  assert.equal(res2.output, 'echo:T');

  // cleanup: force idle exit
  fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
});

test('version mismatch: serves the request, then exits and removes its socket', async () => {
  const socketPath = tmpSocketPath();
  const exits = [];
  runDaemon({
    socketPath,
    idleTimeoutMs: 800,
    handleRequest: async () => 'served-by-old-version',
    exit: (code) => exits.push(code),
  });
  await waitForSocket(socketPath);

  const res = await sendRequest(socketPath, makeRequest({ pluginVersion: '999.0.0' }));
  assert.equal(res.output, 'served-by-old-version', 'mismatch request is still served');
  assert.equal(res.willExit, true);
  // shutdown is synchronous after the response
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(exits, [0]);
  assert.equal(fs.existsSync(socketPath), false, 'socket cleaned up on exit');
});

test('idle timeout exits cleanly and removes the socket', async () => {
  const socketPath = tmpSocketPath();
  const exits = [];
  runDaemon({
    socketPath,
    idleTimeoutMs: 120,
    handleRequest: async () => 'x',
    exit: (code) => exits.push(code),
  });
  await waitForSocket(socketPath);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(exits, [0]);
  assert.equal(fs.existsSync(socketPath), false);
});

test('handler failure responds with null output (client falls back inline)', async () => {
  const socketPath = tmpSocketPath();
  const exits = [];
  runDaemon({
    socketPath,
    idleTimeoutMs: 800,
    handleRequest: async () => {
      throw new Error('boom');
    },
    exit: (code) => exits.push(code),
  });
  await waitForSocket(socketPath);
  const res = await sendRequest(socketPath, makeRequest());
  assert.equal(res.output, null);
  assert.deepEqual(exits, [], 'a failing request never takes the daemon down');
  fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
});

test('second daemon on the same socket exits quietly (EADDRINUSE)', async () => {
  const socketPath = tmpSocketPath();
  const exitsA = [];
  const exitsB = [];
  runDaemon({
    socketPath,
    idleTimeoutMs: 800,
    handleRequest: async () => 'A',
    exit: (c) => exitsA.push(c),
  });
  await waitForSocket(socketPath);
  runDaemon({
    socketPath,
    idleTimeoutMs: 800,
    handleRequest: async () => 'B',
    exit: (c) => exitsB.push(c),
  });
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(exitsB, [0], 'loser exits 0');
  assert.deepEqual(exitsA, [], 'winner unaffected');
  const res = await sendRequest(socketPath, makeRequest());
  assert.equal(res.output, 'A', 'winner still serving');
  fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
});
