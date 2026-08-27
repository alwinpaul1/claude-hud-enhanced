#!/usr/bin/env node
/**
 * End-to-end check for the usage-refresh gates, run against a real build.
 *
 *   node scripts/verify-usage-lag.mjs [buildDir]     # default ./dist
 *
 * Unit tests cover the predicate. This drives the shipped statusline binary
 * instead: a real render, a real single-flight lock, a real detached child, and
 * a real snapshot file. Every scenario runs inside a throwaway CLAUDE_CONFIG_DIR
 * that holds no credentials, so the refresher can reach no network and the real
 * profile is never read or written.
 *
 * Exit 0 = every scenario matched. Run it against the pre-fix build to watch
 * scenarios 1 and 2 fail, which is the bug this verifies gone.
 */
import { spawn, spawnSync } from 'node:child_process';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SOURCE_BUILD = path.resolve(process.argv[2] ?? path.join(REPO, 'dist'));
const SPAWN_WAIT_MS = 5_000;

const results = [];
let root;

function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-verify-'));
  const build = path.join(root, 'build');
  fs.cpSync(SOURCE_BUILD, build, { recursive: true });
  fs.writeFileSync(path.join(build, 'refresh-usage.js'), STUB, 'utf8');
  return build;
}

/**
 * Stands in for the detached refresher so spawns can be counted exactly. It
 * releases the single-flight lock the way the real child's `finally` does, so a
 * suppressed spawn proves the GATE suppressed it and not a lock left lying
 * around. STUB_MODE=land also stamps a successful read, closing the active gate.
 */
const STUB = `import * as fs from 'node:fs';
const dir = process.env.HUD_VERIFY_DIR;
fs.appendFileSync(\`\${dir}/spawns.log\`, \`\${Date.now()}\\n\`);
try { fs.rmSync(process.env.HUD_VERIFY_LOCK, { force: true }); } catch {}
if (process.env.STUB_MODE === 'land') {
  const p = process.env.HUD_VERIFY_SNAPSHOT;
  const at = new Date().toISOString();
  const prev = JSON.parse(fs.readFileSync(p, 'utf8'));
  fs.writeFileSync(p, JSON.stringify({ ...prev, updated_at: at, oauth_updated_at: at, source: 'oauth' }, null, 2));
}
`;

function profile(name) {
  const configDir = path.join(root, name);
  const hudDir = path.join(configDir, 'plugins', 'claude-hud-enhanced');
  fs.mkdirSync(hudDir, { recursive: true });
  fs.writeFileSync(
    path.join(hudDir, 'config.json'),
    JSON.stringify({ display: { oauthUsagePoll: true, idleUsageReset: false } }),
  );
  return { configDir, hudDir, snapshot: path.join(hudDir, 'usage-snapshot.json') };
}

function seed(p, snapshot) {
  fs.writeFileSync(p.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function render(build, p, { fiveHour, sevenDay, stubMode = 'count' }) {
  const stdin = JSON.stringify({
    model: { display_name: 'Opus 5' },
    context_window: { current_usage: { input_tokens: 1000 }, context_window_size: 200000 },
    transcript_path: path.join(root, 'absent.jsonl'),
    rate_limits: {
      five_hour: { used_percentage: fiveHour, resets_at: new Date(Date.now() + 3 * 3600_000).toISOString() },
      seven_day: { used_percentage: sevenDay, resets_at: new Date(Date.now() + 3 * 86400_000).toISOString() },
    },
  });
  const out = spawnSync(process.execPath, [path.join(build, 'index.js')], {
    input: stdin,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: p.configDir,
      HUD_VERIFY_DIR: p.hudDir,
      HUD_VERIFY_LOCK: path.join(p.hudDir, '.usage-snapshot.lock'),
      HUD_VERIFY_SNAPSHOT: p.snapshot,
      STUB_MODE: stubMode,
    },
  });
  return out.stdout ?? '';
}

function spawnCount(p) {
  const log = path.join(p.hudDir, 'spawns.log');
  if (!fs.existsSync(log)) return 0;
  return fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length;
}

/** Detached children are async; give the expected count a bounded chance to land. */
function settle(p, expected) {
  const deadline = Date.now() + SPAWN_WAIT_MS;
  while (Date.now() < deadline) {
    if (spawnCount(p) >= expected) break;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},60)']);
  }
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},250)']);
  return spawnCount(p);
}

function check(name, actual, expected, note) {
  const ok = actual === expected;
  results.push({ name, ok, actual, expected, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}${note ? `\n      ${note}` : ''}`);
}

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const soon = (ms) => new Date(Date.now() + ms).toISOString();

function legacySnapshot(extra = {}) {
  return {
    updated_at: ago(5_000),
    source: 'stdin',
    five_hour: { used_percentage: 8, resets_at: soon(3 * 3600_000) },
    seven_day: { used_percentage: 4, resets_at: soon(3 * 86400_000) },
    status: 'ok',
    next_attempt_at: null,
    ...extra,
  };
}

const build = setup();
console.log(`build under test: ${SOURCE_BUILD}\nsandbox: ${root}\n`);

// 1. The reported bug. Mid-conversation, stdin advancing, last live read stale.
//    Before the fix every stdin write re-stamped the only clock the gate read,
//    so this spawned nothing and the HUD went blind to usage burned elsewhere.
{
  const p = profile('active-stale');
  seed(p, legacySnapshot({ oauth_updated_at: ago(10 * 60_000) }));
  render(build, p, { fiveHour: 9, sevenDay: 4 });
  check('active session with a stale live read refreshes', settle(p, 1), 1,
    'this is the reported defect: it was 0 before the fix');
}

// 2. Idle gate, sampled between the old 180s and the new 60s.
{
  const p = profile('idle-90s');
  seed(p, legacySnapshot({ updated_at: ago(90_000), oauth_updated_at: ago(90_000) }));
  render(build, p, { fiveHour: 8, sevenDay: 4 });
  check('idle 90s refreshes', settle(p, 1), 1,
    'inside the old 180s TTL, past the new 60s one');
}

// 3. Chatting with a live read still inside its budget must not poll.
{
  const p = profile('active-fresh');
  seed(p, legacySnapshot({ oauth_updated_at: ago(5_000) }));
  render(build, p, { fiveHour: 9, sevenDay: 4 });
  render(build, p, { fiveHour: 10, sevenDay: 4 });
  render(build, p, { fiveHour: 11, sevenDay: 4 });
  check('active session with a fresh live read stays quiet', settle(p, 0), 0,
    'three advancing renders, no poll');
}

// 4. Termination. Once a read lands the gate closes, and the lock is not what
//    is doing the throttling: the stub drops it before the next render.
{
  const p = profile('lands-once');
  seed(p, legacySnapshot({ oauth_updated_at: ago(10 * 60_000) }));
  render(build, p, { fiveHour: 9, sevenDay: 4, stubMode: 'land' });
  settle(p, 1);
  render(build, p, { fiveHour: 10, sevenDay: 4, stubMode: 'land' });
  render(build, p, { fiveHour: 11, sevenDay: 4, stubMode: 'land' });
  check('a landed read closes the gate', settle(p, 1), 1,
    'no storm once the live clock is fresh');
}

// 5. Backoff outranks both gates, so a failing refresher is not respawned.
{
  const p = profile('backoff');
  seed(p, legacySnapshot({ oauth_updated_at: null, status: 'error', next_attempt_at: soon(120_000) }));
  render(build, p, { fiveHour: 9, sevenDay: 4 });
  render(build, p, { fiveHour: 10, sevenDay: 4 });
  check('an in-flight backoff suppresses every gate', settle(p, 0), 0);
}

// 6. A snapshot from a pre-upgrade build has no oauth_updated_at at all. Its
//    values must survive the upgrade rather than being discarded as corrupt.
{
  const p = profile('legacy-render');
  seed(p, legacySnapshot());
  const out = render(build, p, { fiveHour: 8, sevenDay: 4 });
  const plain = out.replace(/\[[0-9;]*m/g, '');
  check('a pre-upgrade snapshot still renders its values', /8%/.test(plain) && /4%/.test(plain), true,
    plain.split('\n').filter(Boolean).pop());
}

// 7. The real refresher, not the stub: with no credentials in the sandbox it
//    reaches no network, and must still act rather than bail on a fresh
//    updated_at. A child that bails where the parent spawned is a spawn storm.
{
  const p = profile('real-child');
  seed(p, legacySnapshot({ updated_at: ago(1_000), oauth_updated_at: ago(10 * 60_000) }));
  spawnSync(process.execPath, [path.join(SOURCE_BUILD, 'refresh-usage.js')], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: p.configDir },
    encoding: 'utf8',
  });
  const after = JSON.parse(fs.readFileSync(p.snapshot, 'utf8'));
  check('the real refresher honours the same gate the parent spawned on',
    after.status, 'auth_expired',
    'no token in the sandbox, so it records auth_expired without a request');
  check('a failed poll preserves last-good values', after.five_hour.used_percentage, 8);
  check('a failed poll sets a backoff', typeof after.next_attempt_at === 'string', true);
}

// 8. The daemon is the configured path for anyone with daemon.enabled, and it
//    is a long-lived process rather than a fresh one per render. It serves
//    renders through the same main(), so the gate must fire there too; checking
//    only the direct binary would be checking a surface the user does not run.
{
  const p = profile('daemon');
  seed(p, legacySnapshot({ oauth_updated_at: ago(10 * 60_000) }));
  const { getIpcPath, encodeMessage } = await import(path.join(build, 'daemon-ipc.js'));
  const version = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: p.configDir,
    HUD_VERIFY_DIR: p.hudDir,
    HUD_VERIFY_LOCK: path.join(p.hudDir, '.usage-snapshot.lock'),
    HUD_VERIFY_SNAPSHOT: p.snapshot,
    STUB_MODE: 'count',
  };
  // getIpcPath reads CLAUDE_CONFIG_DIR from the CURRENT process at call time.
  // Without staging it here it resolves to the caller's own profile, and this
  // scenario connects to the developer's live daemon instead of the sandbox one.
  const outerConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const callerSocket = getIpcPath(os.homedir());
  process.env.CLAUDE_CONFIG_DIR = p.configDir;
  const socketPath = getIpcPath(os.homedir());
  if (outerConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = outerConfigDir;
  // The sandbox path is long enough to trip the sun_path limit, so getIpcPath
  // returns its short per-profile-hashed fallback rather than a path under the
  // sandbox root. Identity is what matters: this must not be the caller's own
  // daemon. Without this guard the scenario connected to the developer's live
  // daemon, which answered, and the failure read as a product bug.
  if (socketPath === callerSocket) {
    throw new Error(`refusing to drive the caller's own daemon: ${socketPath}`);
  }
  const daemon = spawn(
    process.execPath,
    ['-e', `import(${JSON.stringify(path.join(build, 'daemon.js'))}).then((m) => m.runDaemon())`],
    { env, stdio: 'ignore' },
  );
  try {
    const deadline = Date.now() + SPAWN_WAIT_MS;
    while (!fs.existsSync(socketPath) && Date.now() < deadline) {
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},50)']);
    }
    const served = fs.existsSync(socketPath) && await new Promise((resolve) => {
      const socket = net.connect(socketPath);
      const done = (v) => { try { socket.destroy(); } catch {} resolve(v); };
      socket.on('error', () => done(false));
      socket.on('data', () => done(true));
      socket.on('connect', () => socket.write(encodeMessage({
        v: 1,
        pluginVersion: version,
        cwd: root,
        // The real client sends the requesting session's FULL environment, and
        // applyRequestEnv deletes every key absent from it. Sending one key
        // stripped the sandbox wiring before the render, which read as the gate
        // failing to fire.
        env: Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string')),
        stdin: {
          model: { display_name: 'Opus 5' },
          context_window: { current_usage: { input_tokens: 1000 }, context_window_size: 200000 },
          transcript_path: path.join(root, 'absent.jsonl'),
          rate_limits: {
            five_hour: { used_percentage: 9, resets_at: soon(3 * 3600_000) },
            seven_day: { used_percentage: 4, resets_at: soon(3 * 86400_000) },
          },
        },
      })));
      setTimeout(() => done(false), SPAWN_WAIT_MS);
    });
    check('the daemon served a render', served, true, `socket ${socketPath}`);
    check('the daemon refreshes on the same gate', settle(p, 1), 1,
      'daemon.enabled is the real configured path here');
  } finally {
    daemon.kill('SIGKILL');
    fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
  }
}

fs.rmSync(root, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} scenarios matched`);
process.exit(failed.length === 0 ? 0 : 1);
