import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { runDaemon, safeColumns, applyRequestEnv, restoreEnv } from '../dist/daemon.js';
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

test('many concurrent clients against ONE daemon all get served (multi-terminal)', async () => {
  const socketPath = tmpSocketPath();
  const exits = [];
  let served = 0;
  runDaemon({
    socketPath,
    idleTimeoutMs: 2_000,
    handleRequest: async (req) => {
      served += 1;
      return `n=${req.stdin.model.display_name}`;
    },
    exit: (code) => exits.push(code),
  });
  await waitForSocket(socketPath);
  // 12 terminals repainting at once, each its own connection.
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      sendRequest(socketPath, makeRequest({ stdin: { model: { display_name: `t${i}` } } })),
    ),
  );
  assert.equal(results.length, 12);
  assert.ok(results.every((r) => r.output.startsWith('n=t')), 'every client got a render');
  assert.equal(served, 12, 'daemon served all 12 without dropping any');
  assert.deepEqual(exits, [], 'stayed up under concurrent load');
  fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
});

test('two profiles get two independent daemons on distinct sockets', async () => {
  const sockA = tmpSocketPath();
  const sockB = tmpSocketPath();
  const exitsA = [];
  const exitsB = [];
  runDaemon({ socketPath: sockA, idleTimeoutMs: 2_000, handleRequest: async () => 'A', exit: (c) => exitsA.push(c) });
  runDaemon({ socketPath: sockB, idleTimeoutMs: 2_000, handleRequest: async () => 'B', exit: (c) => exitsB.push(c) });
  await waitForSocket(sockA);
  await waitForSocket(sockB);
  assert.notEqual(sockA, sockB, 'distinct socket paths');
  const [ra, rb] = await Promise.all([
    sendRequest(sockA, makeRequest()),
    sendRequest(sockB, makeRequest()),
  ]);
  assert.equal(ra.output, 'A', 'profile A served by daemon A');
  assert.equal(rb.output, 'B', 'profile B served by daemon B');
  assert.deepEqual(exitsA, []);
  assert.deepEqual(exitsB, []);
  fs.rmSync(path.dirname(sockA), { recursive: true, force: true });
  fs.rmSync(path.dirname(sockB), { recursive: true, force: true });
});

test('timed-out orphan handler cannot corrupt a later request\'s COLUMNS (env staged in queue, not handler)', async () => {
  const socketPath = tmpSocketPath();
  const prevGlobal = process.env.COLUMNS;
  const seen = [];
  let call = 0;
  runDaemon({
    socketPath,
    idleTimeoutMs: 2_000,
    handlerTimeoutMs: 60, // request A will orphan past this
    handleRequest: async () => {
      call += 1;
      seen.push({ call, columns: process.env.COLUMNS });
      if (call === 1) {
        await new Promise((r) => setTimeout(r, 250)); // A: slow, orphans
        return 'A-late';
      }
      return 'B-fast';
    },
    exit: () => {},
  });
  await waitForSocket(socketPath);

  const resA = await sendRequest(socketPath, makeRequest({ env: { COLUMNS: '80' } }));
  assert.equal(resA.output, null, 'A timed out → null (client would fall back inline)');
  const resB = await sendRequest(socketPath, makeRequest({ env: { COLUMNS: '120' } }));
  assert.equal(resB.output, 'B-fast');
  assert.equal(seen[1].columns, '120', "B renders with B's width, not A's");

  // Let A's orphan finish, then confirm it did NOT stomp the env afterwards.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(process.env.COLUMNS, prevGlobal, 'daemon env restored; orphan never re-mutates');
  fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
});

test('safeColumns validates the COLUMNS trust boundary', () => {
  assert.equal(safeColumns('120'), '120', 'sane width passes');
  assert.equal(safeColumns('1'), '1');
  assert.equal(safeColumns('2000'), '2000');
  assert.equal(safeColumns('999999999'), undefined, 'out-of-range rejected');
  assert.equal(safeColumns('0'), undefined, 'zero rejected');
  assert.equal(safeColumns('-5'), undefined, 'negative rejected');
  assert.equal(safeColumns('abc'), undefined, 'non-numeric rejected');
  assert.equal(safeColumns(undefined), undefined, 'absent stays absent');
  assert.equal(safeColumns('80; rm -rf'), '80', 'parseInt stops at first non-digit (no injection past it)');
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

// --- Per-request env staging (the "Bedrock leak" class) ---------------------
//
// The daemon outlives every session that talks to it, so anything a render
// reads from the daemon's OWN process.env is the env of whichever session
// started it first. That is not hypothetical: a `CLAUDE_CODE_USE_BEDROCK=1`
// session left a daemon that labelled every Claude-subscription session
// "Bedrock", and because shouldHideUsage() treats Bedrock as API-billed, it also
// hid the 5h and weekly usage windows. ANTHROPIC_API_KEY and CLAUDE_HUD_DISABLE
// are the same shape.

test('daemon renders with the REQUESTING session env, not its own (Bedrock leak)', async () => {
  const socketPath = tmpSocketPath();
  const prev = process.env.CLAUDE_CODE_USE_BEDROCK;
  // The daemon process is itself a Bedrock session — the state a Bedrock
  // launcher leaves behind for every later terminal on the same profile.
  process.env.CLAUDE_CODE_USE_BEDROCK = '1';
  const seen = [];
  runDaemon({
    socketPath,
    idleTimeoutMs: 2_000,
    handleRequest: async () => {
      seen.push(process.env.CLAUDE_CODE_USE_BEDROCK);
      return 'ok';
    },
    exit: () => {},
  });
  await waitForSocket(socketPath);

  // A subscription session asks for a render. Its env carries no Bedrock flag.
  const res = await sendRequest(socketPath, makeRequest({ env: { COLUMNS: '100' } }));
  assert.equal(res.output, 'ok');
  assert.equal(seen[0], undefined, "render must not see the daemon's own CLAUDE_CODE_USE_BEDROCK");
  assert.equal(process.env.CLAUDE_CODE_USE_BEDROCK, '1', "daemon's own env restored after the render");

  if (prev === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
  else process.env.CLAUDE_CODE_USE_BEDROCK = prev;
  fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
});

test('a variable only the CLIENT has still reaches the render', async () => {
  const socketPath = tmpSocketPath();
  assert.equal(process.env.HUD_TEST_CLIENT_ONLY, undefined, 'precondition: daemon lacks it');
  const seen = [];
  runDaemon({
    socketPath,
    idleTimeoutMs: 2_000,
    handleRequest: async () => {
      seen.push(process.env.HUD_TEST_CLIENT_ONLY);
      return 'ok';
    },
    exit: () => {},
  });
  await waitForSocket(socketPath);

  await sendRequest(socketPath, makeRequest({ env: { HUD_TEST_CLIENT_ONLY: 'yes' } }));
  assert.equal(seen[0], 'yes');
  assert.equal(process.env.HUD_TEST_CLIENT_ONLY, undefined, 'not leaked back into the daemon');
  fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
});

test('applyRequestEnv mutates process.env IN PLACE and restoreEnv is exact', () => {
  const identity = process.env;
  const snapshot = { ...process.env };
  applyRequestEnv({ HUD_TEST_ONLY_KEY: 'v', COLUMNS: '90' });
  assert.equal(process.env, identity, 'must not replace the exotic env object');
  assert.equal(process.env.HUD_TEST_ONLY_KEY, 'v');
  assert.equal(process.env.COLUMNS, '90');
  restoreEnv(snapshot);
  assert.equal(process.env.HUD_TEST_ONLY_KEY, undefined);
  assert.deepEqual({ ...process.env }, snapshot, 'restore is byte-exact');
});

test('applyRequestEnv keeps COLUMNS a validated trust boundary', () => {
  const snapshot = { ...process.env };
  applyRequestEnv({ COLUMNS: 'not-a-number' });
  assert.equal(process.env.COLUMNS, undefined, 'an unusable width is dropped, never passed through');
  applyRequestEnv({ COLUMNS: '999999' });
  assert.equal(process.env.COLUMNS, undefined, 'out-of-range width is dropped');
  restoreEnv(snapshot);
});

// Maintenance-free gate: every env name the source reads is discovered by
// reading src/, so a variable added later is canaried without touching this
// test. A new module-scope read is the one thing per-request staging cannot
// cover, which is why the daemon also boots with a scrubbed env.
test('EVERY env name read in src/ is served from the request, not the daemon', async () => {
  const srcDir = new URL('../src/', import.meta.url);
  const names = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.ts')) {
        const text = fs.readFileSync(child, 'utf8');
        for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]+)\b/g)) names.add(m[1]);
      }
    }
  };
  walk(srcDir);
  names.delete('COLUMNS'); // validated separately; not copied verbatim
  // CLAUDE_CONFIG_DIR cannot be canaried: the profile guard requires the
  // request and the daemon to agree on it before the render is served at all.
  names.delete('CLAUDE_CONFIG_DIR');
  assert.ok(names.size >= 4, `expected to discover env reads, found ${names.size}`);

  const socketPath = tmpSocketPath();
  const snapshot = { ...process.env };
  for (const name of names) process.env[name] = 'DAEMON_CANARY';
  const seen = [];
  runDaemon({
    socketPath,
    idleTimeoutMs: 2_000,
    handleRequest: async () => {
      seen.push(Object.fromEntries([...names].map((n) => [n, process.env[n]])));
      return 'ok';
    },
    exit: () => {},
  });
  await waitForSocket(socketPath);

  const requestEnv = Object.fromEntries([...names].map((n) => [n, 'CLIENT_VALUE']));
  // Echo the profile back so the guard passes; it is the one value that must
  // match rather than be overridden.
  if (process.env.CLAUDE_CONFIG_DIR != null) {
    requestEnv.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
  }
  await sendRequest(socketPath, makeRequest({ env: requestEnv }));
  for (const name of names) {
    assert.equal(seen[0][name], 'CLIENT_VALUE', `${name} must come from the request, not the daemon`);
  }
  restoreEnv(snapshot);
  fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
});
