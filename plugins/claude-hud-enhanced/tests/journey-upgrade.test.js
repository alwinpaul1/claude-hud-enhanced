import './helpers/isolate-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {
  applySetup,
  createRepo,
  createWorld,
  hasReleaseTag,
  installPlugin,
  installReleasedBuild,
  isAlive,
  isPosix,
  listDir,
  resolveInProfile,
  runStatusline,
  runStatuslineAsync,
  setupCommand,
  stdinFor,
  stopDaemon,
  waitFor,
  writeAccount,
  writeSettings,
  writeTranscript,
} from './helpers/world.mjs';

const skip = isPosix ? false : 'the bash launcher journey runs on macOS and Linux';

let repoFixture = null;
const sharedRepo = () => (repoFixture ??= createRepo(createWorld('repo')));

function installedWorld(label, install = {}) {
  const world = createWorld(label);
  const repo = sharedRepo();
  for (const profile of Object.values(world.profiles)) {
    writeSettings(profile, { theme: profile.name === 'default' ? 'light' : 'dark', subagentStatusLine: { type: 'command', command: '/bin/true' } });
    writeAccount(world, profile);
    installPlugin(profile, install);
    applySetup(profile, setupCommand('node', process.execPath));
  }
  const transcript = writeTranscript(world);
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: transcript.transcriptPath });
  return { world, repo, stdin, transcript };
}

function layoutOf(run) {
  if (run.pillLines.length > 0) return 'pills';
  if (run.plainLines.some((line) => line.startsWith('Context '))) return 'expanded';
  if (run.plainLines[0]?.startsWith('[Opus')) return 'compact';
  return `unknown: ${JSON.stringify(run.stdout)}`;
}

function writeConfig(profile, content, dir = profile.dataDir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return file;
}

const V017_CONFIG = {
  layout: 'separators',
  pathLevels: 2,
  gitStatus: { enabled: true, showDirty: true, showAheadBehind: true },
  display: { showModel: true, showContextBar: true, showConfigCounts: true, showDuration: true, showTokenBreakdown: true, showUsage: true, showTools: true, showAgents: true, showTodos: true },
};

const CONFIG_CASES = [
  ['an empty object', {}, 'pills'],
  ['options but no layout', { display: { showTools: true, usageCompact: true, compactSingleRow: true, showConfigCounts: true }, colors: { usage: 'green' }, showSeparators: true, pathLevels: 2 }, 'pills', true],
  ['an explicit compact', { lineLayout: 'compact' }, 'compact', true],
  ['an explicit compact with separators', { lineLayout: 'compact', showSeparators: true }, 'compact'],
  ['an explicit expanded', { lineLayout: 'expanded', showSeparators: false }, 'expanded', true],
  ['an explicit pills', { lineLayout: 'pills' }, 'pills'],
  ['the 0.1.x layout: separators', V017_CONFIG, 'compact', true],
  ['the 0.1.x layout: default', { layout: 'default' }, 'compact'],
  ['a nested layout object', { layout: { lineLayout: 'expanded', showSeparators: true } }, 'expanded'],
  ['a nested layout object with no choice in it', { layout: { pathLevels: 2 } }, 'pills'],
  ['lineLayout beside a stale layout key', { layout: 'separators', lineLayout: 'expanded' }, 'expanded'],
  ['an unknown layout name', { lineLayout: 'fancy' }, 'pills'],
  ['a layout of the wrong type', { lineLayout: 5 }, 'pills'],
  ['removed and unknown keys', { display: { showSonnetUsage: true, usageThreshold: 90, sevenDayThreshold: 80 }, theme: 'neon', usage: { enabled: true }, elementOrder: ['bogus'] }, 'pills'],
  ['truncated JSON', '{ "lineLayout": "compact",', 'pills', true],
  ['a BOM before a compact choice', '﻿{ "lineLayout": "compact" }', 'compact'],
  ['a JSON null', 'null', 'pills'],
  ['a JSON array', '[]', 'pills'],
  ['an empty file', '', 'pills'],
  ['a prototype-pollution attempt', '{ "__proto__": { "lineLayout": "compact" }, "constructor": { "prototype": { "lineLayout": "compact" } } }', 'pills'],
];

test('an existing config keeps a chosen layout and gets pills only when it never chose one', { skip }, () => {
  const { world, stdin } = installedWorld('configs');
  for (const profile of Object.values(world.profiles)) {
    const untouched = runStatusline(world, profile, stdin, { columns: 200 });
    assert.equal(layoutOf(untouched), 'pills', `${profile.name}: no config file`);

    const cases = profile.name === 'work' ? CONFIG_CASES : CONFIG_CASES.filter(([, , , both]) => both);
    for (const [name, content, expected] of cases) {
      const file = writeConfig(profile, content);
      const before = readFileSync(file);
      const run = runStatusline(world, profile, stdin, { columns: 200 });
      const label = `${profile.name}: ${name}`;

      assert.equal(run.status, 0, label);
      assert.equal(run.stderr, '', label);
      assert.equal(layoutOf(run), expected, label);
      assert.doesNotMatch(run.plain, /undefined|NaN|\[claude-hud-enhanced\] Error/, label);
      assert.ok(readFileSync(file).equals(before), `${label}: the config file is never rewritten`);
    }
  }
});

test('the options an older config already set still apply to the pill row', { skip }, () => {
  const { world, stdin } = installedWorld('honoured');
  const profile = world.profiles.work;
  const render = (config) => {
    writeConfig(profile, config);
    const run = runStatusline(world, profile, stdin, { columns: 220, ...(config.gitStatus?.enabled === false && { settled: false }) });
    assert.equal(run.stderr, '');
    assert.equal(layoutOf(run), 'pills');
    return run;
  };

  assert.doesNotMatch(render({ display: { showModel: false } }).plainLines[0], /Opus/);
  assert.doesNotMatch(render({ display: { showUsage: false } }).plainLines[0], /5h|7d/);
  const noGit = render({ gitStatus: { enabled: false } }).plainLines[0];
  assert.ok(noGit.includes('acme-app') && !noGit.includes('main'), noGit);
  assert.doesNotMatch(render({ display: { showEffortLevel: false } }).plainLines[0], /medium/);
  assert.doesNotMatch(render({ display: { showTools: false } }).plain, /Read/);
  assert.ok(render({ display: { modelOverride: 'Custom Model' } }).plainLines[0].includes(' Custom Model '));
});

test('a config in the legacy plugins/claude-hud folder moves over with its layout choice', { skip }, () => {
  const { world, stdin } = installedWorld('legacy');
  const { default: main, work } = world.profiles;

  writeConfig(main, { lineLayout: 'expanded' }, main.legacyDataDir);
  for (const name of ['config-cache', 'transcript-cache']) mkdirSync(path.join(main.legacyDataDir, name), { recursive: true });
  writeFileSync(path.join(main.legacyDataDir, 'usage-cache.json'), '{"data":{"planName":"Max"},"timestamp":1}');
  writeFileSync(path.join(main.legacyDataDir, 'oauth-cache.json'), '{"stale":true}');
  writeFileSync(path.join(main.legacyDataDir, '.usage-cache.json'), 'not json');
  writeFileSync(path.join(main.legacyDataDir, 'transcript-cache', 'old.json'), '{"version":12,"data":{}}');
  writeFileSync(path.join(main.legacyDataDir, 'previous-statusline.txt'), 'echo previous');
  const moved = runStatusline(world, main, stdin, { columns: 200 });
  assert.equal(moved.status, 0);
  assert.equal(moved.stderr, '');
  assert.equal(layoutOf(moved), 'expanded');
  assert.equal(existsSync(main.legacyDataDir), false, 'the legacy folder was renamed');
  assert.deepEqual(JSON.parse(readFileSync(path.join(main.dataDir, 'config.json'), 'utf8')), { lineLayout: 'expanded' });
  assert.equal(readFileSync(path.join(main.dataDir, 'previous-statusline.txt'), 'utf8'), 'echo previous');

  mkdirSync(work.dataDir, { recursive: true });
  writeFileSync(path.join(work.dataDir, 'statusline.mjs'), '// enhanced launcher');
  writeConfig(work, { layout: 'separators' }, work.legacyDataDir);
  writeFileSync(path.join(work.legacyDataDir, 'statusline.mjs'), '// legacy launcher');
  const seeded = runStatusline(world, work, stdin, { columns: 200 });
  assert.equal(seeded.stderr, '');
  assert.equal(layoutOf(seeded), 'compact');
  assert.ok(existsSync(work.legacyDataDir), 'both folders exist: the legacy one is left alone');
  assert.equal(readFileSync(path.join(work.dataDir, 'statusline.mjs'), 'utf8'), '// enhanced launcher');

  writeConfig(work, { lineLayout: 'expanded' });
  writeConfig(work, { lineLayout: 'compact' }, work.legacyDataDir);
  assert.equal(layoutOf(runStatusline(world, work, stdin, { columns: 200 })), 'expanded', 'the enhanced config wins');
});

test('a legacy folder with no layout choice upgrades to pills', { skip }, () => {
  const { world, stdin } = installedWorld('legacy-default');
  const profile = world.profiles.work;
  writeConfig(profile, { display: { showTools: true }, gitStatus: { enabled: true } }, profile.legacyDataDir);
  const run = runStatusline(world, profile, stdin, { columns: 200 });

  assert.equal(run.stderr, '');
  assert.equal(layoutOf(run), 'pills');
  assert.ok(existsSync(path.join(profile.dataDir, 'config.json')));
});

function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walkFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
  );
}

const keepTimes = (file, write) => {
  const { atime, mtime } = statSync(file);
  write();
  utimesSync(file, atime, mtime);
};

test('caches written by an older build are ignored, not rendered', { skip }, async () => {
  const { world, repo, stdin } = installedWorld('caches');
  for (const profile of Object.values(world.profiles)) {
    const clean = runStatusline(world, profile, stdin, { columns: 220 });
    assert.equal(layoutOf(clean), 'pills');
    await waitFor(() => listDir(path.join(profile.dataDir, 'pr-cache')).some((name) => /^pr-[0-9a-f]+\.json$/.test(name)));
    await waitFor(() => !listDir(path.join(profile.dataDir, 'pr-cache')).some((name) => name.endsWith('.lock')));
    const expected = runStatusline(world, profile, stdin, { columns: 220 }).plainLines;

    const transcriptCaches = walkFiles(path.join(profile.dataDir, 'transcript-cache'));
    assert.ok(transcriptCaches.length > 0);
    for (const file of transcriptCaches) {
      const cache = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(cache.version, 17);
      keepTimes(file, () => writeFileSync(file, JSON.stringify({ ...cache, version: 16 }).replaceAll('"Read"', '"POISONED"')));
    }
    const gitCaches = walkFiles(path.join(profile.dataDir, 'git-cache'));
    assert.ok(gitCaches.length > 0);
    for (const file of gitCaches) {
      const cache = JSON.parse(readFileSync(file, 'utf8'));
      assert.equal(cache.version, 2);
      writeFileSync(file, JSON.stringify({ ...cache, version: 1, createdAt: Date.now(), status: { branch: 'STALE-BRANCH', isDirty: false, ahead: 0, behind: 0 } }));
    }
    for (const file of walkFiles(path.join(profile.dataDir, 'config-cache'))) {
      const cache = JSON.parse(readFileSync(file, 'utf8'));
      delete cache.data.claudeTheme;
      keepTimes(file, () => writeFileSync(file, JSON.stringify(cache)));
    }
    for (const file of walkFiles(path.join(profile.dataDir, 'pr-cache'))) {
      if (file.endsWith('.state.json')) writeFileSync(file, '{"version":0,"prView":null}');
      else writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), at: Date.now(), pr: { number: 'x', state: 'WEIRD' }, own: { branch: 7 }, base: 'main' }));
    }

    const upgraded = runStatusline(world, profile, stdin, { columns: 220 });
    assert.equal(upgraded.status, 0, profile.name);
    assert.equal(upgraded.stderr, '', profile.name);
    assert.doesNotMatch(upgraded.plain, /POISONED|STALE-BRANCH|WEIRD|undefined|Error/, profile.name);
    assert.deepEqual(upgraded.plainLines, expected, profile.name);
    assert.ok(upgraded.stdout.includes(profile.name === 'default' ? '\x1b[48;2;226;230;250m' : '\x1b[48;2;40;46;80m'), 'the theme is re-read when the cache predates it');

    for (const file of walkFiles(profile.dataDir)) {
      if (file.endsWith('.lock') || file.endsWith('.sock') || file.endsWith('.pid')) continue;
      writeFileSync(file, '{"version":');
    }
    const wrecked = runStatusline(world, profile, stdin, { columns: 220 });
    assert.equal(wrecked.status, 0, profile.name);
    assert.equal(wrecked.stderr, '', profile.name);
    assert.equal(layoutOf(wrecked), 'pills', profile.name);
    assert.doesNotMatch(wrecked.plain, /undefined|NaN|Error/, profile.name);
    assert.ok(wrecked.plainLines[0].includes(' Opus 5.5 medium │ ◔ '), wrecked.plainLines[0]);
    assert.ok(wrecked.plainLines[0].includes('main ↑2 ↓1 +1 ~1 ?2 '), wrecked.plainLines[0]);
  }
  assert.ok(existsSync(repo.repo));
});

test('a git cache entry with a broken status is refetched instead of crashing the row', { skip }, () => {
  const { world, stdin } = installedWorld('git-cache');
  const profile = world.profiles.work;
  runStatusline(world, profile, stdin, { columns: 220 });
  for (const file of walkFiles(path.join(profile.dataDir, 'git-cache'))) {
    const cache = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...cache, createdAt: Date.now(), status: 'main' }));
  }
  const run = runStatusline(world, profile, stdin, { columns: 220 });

  assert.equal(run.stderr, '');
  assert.doesNotMatch(run.plain, /Error|undefined/);
  assert.ok(run.plainLines[0].includes('main ↑2 ↓1 +1 ~1 ?2 '), run.plainLines[0]);
});

async function withFakeDaemon(world, profile, onRequest, body) {
  const socketPath = resolveInProfile(world, profile, 'm.getIpcPath()');
  mkdirSync(path.dirname(socketPath), { recursive: true });
  rmSync(socketPath, { force: true });
  const requests = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const request = JSON.parse(buffer.slice(0, buffer.indexOf('\n')));
      requests.push(request);
      onRequest(socket, request);
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));
  try {
    return await body(requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(socketPath, { force: true });
  }
}

test('a daemon from an older build still running cannot paint its old layout', { skip }, async () => {
  const { world, stdin } = installedWorld('old-daemon');
  for (const profile of Object.values(world.profiles)) {
    writeConfig(profile, { daemon: { enabled: true } });
    const stale = '[Opus] OLD COMPACT RENDER';

    await withFakeDaemon(
      world,
      profile,
      (socket) => socket.end(`${JSON.stringify({ v: 1, pluginVersion: '0.8.3', output: stale, willExit: true })}\n`),
      async (requests) => {
        const run = await runStatuslineAsync(world, profile, stdin, { columns: 220 });
        assert.equal(requests.length, 1, 'the new client did reach the old daemon');
        assert.notEqual(requests[0].pluginVersion, '0.8.3');
        assert.equal(run.status, 0);
        assert.equal(run.stderr, '');
        assert.doesNotMatch(run.stdout, /OLD COMPACT RENDER/);
        assert.equal(layoutOf(run), 'pills', profile.name);
      },
    );

    await withFakeDaemon(
      world,
      profile,
      (socket, request) => socket.end(`${JSON.stringify({ v: 1, pluginVersion: request.pluginVersion, output: stale, willExit: true })}\n`),
      async () => {
        const run = await runStatuslineAsync(world, profile, stdin, { columns: 220 });
        assert.doesNotMatch(run.stdout, /OLD COMPACT RENDER/, 'a daemon that is on its way out is not trusted either');
        assert.equal(layoutOf(run), 'pills');
      },
    );

    await withFakeDaemon(world, profile, () => undefined, async () => {
      const run = await runStatuslineAsync(world, profile, stdin, { columns: 220 });
      assert.equal(run.status, 0);
      assert.equal(run.stderr, '');
      assert.equal(layoutOf(run), 'pills', 'a daemon that never answers falls back inline');
      assert.ok(run.ms < 20_000, `render took ${run.ms}ms`);
    });

    await withFakeDaemon(world, profile, (socket) => socket.end('\x00garbage\n{"v":99}\n'), async () => {
      const run = await runStatuslineAsync(world, profile, stdin, { columns: 220 });
      assert.equal(run.stderr, '');
      assert.equal(layoutOf(run), 'pills', 'a garbage reply falls back inline');
    });
  }
});

const daemonPid = (profile) => {
  try {
    const pid = Number(readFileSync(path.join(profile.dataDir, 'daemon', 'hud.pid'), 'utf8').trim());
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
};

test('the warm daemon serves the same pill row as the inline render', { skip }, async (t) => {
  const { world, stdin } = installedWorld('daemon');
  const profile = world.profiles.work;
  t.after(() => stopDaemon(profile));
  const inline = runStatusline(world, profile, stdin, { columns: 220 });
  writeConfig(profile, { daemon: { enabled: true } });
  const first = runStatusline(world, profile, stdin, { columns: 220 });
  assert.equal(first.stderr, '');
  assert.deepEqual(first.plainLines, inline.plainLines);

  const pid = await waitFor(() => {
    const value = daemonPid(profile);
    return value && isAlive(value) ? value : null;
  });
  assert.ok(pid, 'the daemon came up');
  for (const columns of [220, 100, 44]) {
    const viaDaemon = runStatusline(world, profile, stdin, { columns });
    writeConfig(profile, {});
    const direct = runStatusline(world, profile, stdin, { columns });
    writeConfig(profile, { daemon: { enabled: true } });
    assert.equal(viaDaemon.status, 0);
    assert.equal(viaDaemon.stderr, '');
    assert.equal(viaDaemon.stdout, direct.stdout, `byte-for-byte at ${columns} columns`);
    assert.equal(layoutOf(viaDaemon), 'pills');
  }
  writeConfig(profile, { daemon: { enabled: true }, lineLayout: 'compact' });
  assert.equal(layoutOf(runStatusline(world, profile, stdin, { columns: 220 })), 'compact', 'the daemon re-reads the config');

  stopDaemon(profile);
  assert.ok(await waitFor(() => !isAlive(pid)), 'the daemon stopped');
});

const RELEASES = ['v0.4.13', 'v0.6.0', 'v0.7.0', 'v0.8.3'];

for (const tag of RELEASES) {
  const tagSkip = skip || (hasReleaseTag(tag) ? false : `${tag} is not in this checkout`);

  test(`updating from the released ${tag} build keeps its data and switches to pills`, { skip: tagSkip }, async (t) => {
    const world = createWorld(`from-${tag}`);
    const repo = sharedRepo();
    const transcript = writeTranscript(world);
    const stdin = stdinFor({ cwd: repo.repo, transcriptPath: transcript.transcriptPath });
    const supportsDaemon = tag !== 'v0.4.13';
    for (const profile of Object.values(world.profiles)) {
      t.after(() => stopDaemon(profile));
      writeSettings(profile, { theme: profile.name === 'default' ? 'light' : 'dark' });
      writeAccount(world, profile);
      installReleasedBuild(profile, tag);
      applySetup(profile, setupCommand('node', process.execPath));
      if (supportsDaemon) writeConfig(profile, { daemon: { enabled: true } });

      const old = runStatusline(world, profile, stdin, { columns: 200 });
      assert.equal(old.status, 0, `${tag} ${profile.name}`);
      assert.equal(layoutOf(old), 'compact', `${tag} rendered its own default`);
      let oldPid = null;
      if (supportsDaemon) {
        oldPid = await waitFor(() => {
          const value = daemonPid(profile);
          return value && isAlive(value) ? value : null;
        });
        assert.ok(oldPid, `${tag} started its daemon`);
        assert.equal(layoutOf(runStatusline(world, profile, stdin, { columns: 200 })), 'compact');
      }
      assert.ok(walkFiles(path.join(profile.dataDir, 'transcript-cache')).length > 0, 'the old build left its caches');

      installPlugin(profile, { real: '0.99.0', stubs: [] });
      const upgraded = runStatusline(world, profile, stdin, { columns: 200 });
      assert.equal(upgraded.status, 0, `${tag} ${profile.name}`);
      assert.equal(upgraded.stderr, '', `${tag} ${profile.name}`);
      assert.equal(layoutOf(upgraded), 'pills', `the first repaint after updating from ${tag} is already the pill row`);
      assert.ok(upgraded.plainLines[0].includes(' Opus 5.5 medium │ ◔ '), upgraded.plainLines[0]);
      assert.ok(upgraded.plainLines[0].includes('main ↑2 ↓1 +1 ~1 ?2 '), upgraded.plainLines[0]);
      assert.match(upgraded.plain, /✓ Read/);
      assert.ok(upgraded.stdout.includes(profile.name === 'default' ? '\x1b[48;2;226;230;250m' : '\x1b[48;2;40;46;80m'));

      if (oldPid) {
        assert.ok(await waitFor(() => !isAlive(oldPid)), `the ${tag} daemon stepped down`);
        const spawnLock = path.join(profile.dataDir, 'daemon', 'hud.spawn.lock');
        if (existsSync(spawnLock)) utimesSync(spawnLock, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
        const newPid = await waitFor(() => {
          runStatusline(world, profile, stdin, { columns: 200 });
          const value = daemonPid(profile);
          return value && value !== oldPid && isAlive(value) ? value : null;
        }, 20_000, 250);
        assert.ok(newPid, 'a daemon of the new build took over');
        const served = runStatusline(world, profile, stdin, { columns: 200 });
        assert.equal(served.stderr, '');
        assert.equal(layoutOf(served), 'pills');
      }

      writeConfig(profile, { lineLayout: 'compact', ...(supportsDaemon ? { daemon: { enabled: true } } : {}) });
      const kept = runStatusline(world, profile, stdin, { columns: 200 });
      assert.equal(kept.stderr, '');
      assert.equal(layoutOf(kept), 'compact', 'a chosen layout survives the update');
      stopDaemon(profile);
    }
  });
}

const HISTORIC_LAUNCHERS = [
  {
    name: '0.1.7, a fixed ~/.claude cache path',
    profiles: ['default'],
    marketplace: 'claude-hud-enhanced',
    command: (node) => `bash -c 'B=~/.claude/plugins/cache/claude-hud-enhanced/claude-hud-enhanced; V=$(ls "$B" 2>/dev/null | sort -t. -k1,1n -k2,2n -k3,3n | tail -1); exec "${node}" "$B/$V/dist/index.js"'`,
  },
  {
    name: '0.2.x, the claude-hud marketplace glob with no COLUMNS',
    profiles: ['default', 'work'],
    marketplace: 'claude-hud',
    pluginName: 'claude-hud',
    command: (node) => `bash -c 'plugin_dir=$(ls -d "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/claude-hud/claude-hud/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\\t" $(0) }'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "${node}" "\${plugin_dir}dist/index.js"'`,
  },
  {
    name: '0.3.1 to 0.6.x, stty before the redirect',
    profiles: ['default', 'work'],
    marketplace: 'claude-hud-enhanced',
    command: (node) => `bash -c 'cols=\${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size </dev/tty 2>/dev/null | awk '"'"'{print $2}'"'"');; esac; case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$(ls -d "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud-enhanced/*/ 2>/dev/null | awk -F/ '"'"'{ print $(NF-1) "\\t" $(0) }'"'"' | grep -E '"'"'^[0-9]+\\.[0-9]+\\.[0-9]+[[:space:]]'"'"' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 | cut -f2-); exec "${node}" "\${plugin_dir}dist/index.js"'`,
  },
  {
    name: 'the Git Bash form with sort -V',
    profiles: ['default', 'work'],
    marketplace: 'claude-hud-enhanced',
    needs: 'printf "0.9.0\\n0.10.0\\n" | sort -V',
    command: (node) => `cols=\${COLUMNS:-}; case "$cols" in ""|*[!0-9]*) cols=$(stty size 2>/dev/null </dev/tty | awk '{print $2}');; esac; case "$cols" in ""|*[!0-9]*) cols=120;; esac; export COLUMNS=$(( cols > 4 ? cols - 4 : 1 )); plugin_dir=$(ls -1d "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/claude-hud-enhanced/*/ 2>/dev/null | sort -V | tail -1); exec "${node}" "\${plugin_dir}dist/index.js"`,
  },
];

for (const launcher of HISTORIC_LAUNCHERS) {
  const usable = !launcher.needs || spawnSync('sh', ['-c', launcher.needs], { encoding: 'utf8' }).stdout === '0.9.0\n0.10.0\n';

  test(`a statusLine command written by ${launcher.name} runs the new build`, { skip: skip || (usable ? false : 'sort -V is unavailable') }, () => {
    const world = createWorld('launcher');
    const repo = sharedRepo();
    const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });
    for (const name of launcher.profiles) {
      const profile = world.profiles[name];
      const base = path.join(profile.cacheDir, launcher.marketplace, launcher.pluginName ?? 'claude-hud-enhanced');
      installPlugin(profile, { marketplace: launcher.marketplace, stubs: ['0.8.3', '0.9.0'] });
      if (launcher.pluginName) {
        mkdirSync(path.dirname(base), { recursive: true });
        spawnSync('mv', [path.join(profile.cacheDir, launcher.marketplace, 'claude-hud-enhanced'), base]);
      }
      rmSync(path.join(base, 'not-a-version'), { recursive: true, force: true });
      writeSettings(profile, { theme: 'dark', statusLine: { type: 'command', command: launcher.command(process.execPath) } });
      const run = runStatusline(world, profile, stdin, { columns: 200 });

      assert.equal(run.status, 0, name);
      assert.equal(run.stderr, '', name);
      assert.doesNotMatch(run.stdout, /STALE BUILD/, name);
      assert.equal(layoutOf(run), 'pills', name);
      assert.ok(run.plainLines[0].includes('main ↑2 ↓1 +1 ~1 ?2 '), run.plainLines[0]);
      assert.ok(existsSync(profile.dataDir), `${name} wrote into its own profile`);
    }
  });
}
