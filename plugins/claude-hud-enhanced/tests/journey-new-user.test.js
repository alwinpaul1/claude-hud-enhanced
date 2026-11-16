import './helpers/isolate-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  CAP_LEFT,
  CAP_RIGHT,
  DARK_BLUE_BG,
  LAUNCHER_TOOLS,
  LIGHT_BLUE_BG,
  applySetup,
  createRepo,
  createWorld,
  findRuntime,
  installPlugin,
  isPosix,
  listDir,
  readSettings,
  runStatusline,
  setupCommand,
  stdinFor,
  toolBin,
  visibleWidth,
  waitFor,
  writeAccount,
  writeGhStub,
  writeSettings,
  writeTranscript,
} from './helpers/world.mjs';

const skip = isPosix ? false : 'the bash launcher journey runs on macOS and Linux';
const bunPath = isPosix ? findRuntime('bun') : null;

const FOREIGN_SETTINGS = {
  env: { EXAMPLE_FLAG: '1' },
  permissions: { allow: ['Bash(git status)'] },
  subagentStatusLine: { type: 'command', command: '/bin/true' },
  outputStyle: 'default',
};

let repoFixture = null;

function sharedRepo() {
  repoFixture ??= createRepo(createWorld('repo'));
  return repoFixture;
}

function freshInstall(label, themes = { default: 'light', work: 'dark-ansi' }, install = {}) {
  const world = createWorld(label);
  const repo = sharedRepo();
  for (const profile of Object.values(world.profiles)) {
    writeSettings(profile, { ...FOREIGN_SETTINGS, theme: themes[profile.name] });
    writeAccount(world, profile);
    installPlugin(profile, install);
    applySetup(profile, setupCommand('node', process.execPath));
  }
  return { world, repo };
}

const PILLS = { lineLayout: 'pills', display: { pillCaps: true } };

function writeHudConfig(profile, config) {
  mkdirSync(profile.dataDir, { recursive: true });
  writeFileSync(path.join(profile.dataDir, 'config.json'), JSON.stringify(config));
}

function pillsInstall(label, themes, install) {
  const made = freshInstall(label, themes, install);
  for (const profile of Object.values(made.world.profiles)) writeHudConfig(profile, PILLS);
  return made;
}

const prSnapshotFiles = (profile) =>
  listDir(path.join(profile.dataDir, 'pr-cache')).filter((name) => /^pr-[0-9a-f]+\.json$/.test(name));

const prLocks = (profile) => listDir(path.join(profile.dataDir, 'pr-cache')).filter((name) => name.endsWith('.lock'));

async function settlePr(profile) {
  const settled = await waitFor(() => prSnapshotFiles(profile).length > 0 && prLocks(profile).length === 0);
  assert.ok(settled, 'the detached PR refresher wrote its snapshot and released its lock');
}

test('setup verification passes on a machine with no HUD data at all', { skip }, () => {
  const { world } = freshInstall('verify');
  for (const profile of Object.values(world.profiles)) {
    assert.equal(existsSync(profile.dataDir), false);
    const run = runStatusline(world, profile, null, { columns: 120 });

    assert.equal(run.status, 0, profile.name);
    assert.equal(run.stderr, '', profile.name);
    assert.match(run.stdout, /\[claude-hud-enhanced\] Initializing/);
    assert.doesNotMatch(run.stdout, /STALE BUILD/);
  }
});

test('a fresh install renders the compact layout for the default and the CLAUDE_CONFIG_DIR profile', { skip }, () => {
  const { world, repo } = freshInstall('fresh', undefined, { copy: true });
  const transcript = writeTranscript(world);
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: transcript.transcriptPath });
  const { default: main, work } = world.profiles;
  const settingsBefore = readFileSync(main.settingsPath, 'utf8');

  const first = runStatusline(world, main, stdin, { columns: 220 });
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '');
  assert.equal(first.pillLines.length, 0, 'no pill backgrounds in the default layout');
  assert.equal(first.plainLines.length, 2, first.plain);
  const [row, usage] = first.plainLines;
  assert.match(row, /^\[Opus 5\.5 \(1M context\) medium \| Max 20x\] █░+ 7% \(69k\/1\.0M\) \| acme-app git:\(main\* ↑2 ↓1 !1 \+1 \?2\)/);
  assert.match(usage, /^Usage █+░+ 42% \(resets [^)]+\) \| Weekly █+░+ 8% \(resets [^)]+\)$/);
  assert.doesNotMatch(first.stdout, /\x1b\[[34]8;2;/, 'the old layouts use the terminal\'s own colours');
  assert.doesNotMatch(first.stdout, /[\ue000-\uf8ff]/u, 'no private-use glyphs');
  assert.doesNotMatch(first.plain, /✓ Read|◐|▸|─{5}/, 'the activity lines and their separator are off');
  assert.doesNotMatch(first.stdout, /STALE BUILD/);

  assert.equal(statSync(main.dataDir).mode & 0o077, 0, 'the HUD data dir is private');
  assert.equal(existsSync(path.join(main.dataDir, 'config.json')), false, 'rendering never writes a config');
  assert.equal(existsSync(work.dataDir), false, 'the default profile never writes into the other profile');
  assert.equal(readFileSync(main.settingsPath, 'utf8'), settingsBefore);
  assert.deepEqual(readSettings(main).subagentStatusLine, FOREIGN_SETTINGS.subagentStatusLine);

  const second = runStatusline(world, work, stdin, { columns: 220 });
  assert.equal(second.status, 0);
  assert.equal(second.stderr, '');
  assert.equal(second.plainLines[0], row, 'both profiles render the same row');
  assert.equal(second.stdout, first.stdout, 'a light and a dark Claude Code theme get the same ANSI colours');
  assert.ok(existsSync(work.dataDir));
  assert.equal(existsSync(path.join(world.home, '.claude', 'plugins', 'claude-hud')), false);
});

test('choosing pills renders the pill row in the theme\'s palette, with caps only when asked', { skip }, () => {
  const { world, repo } = freshInstall('pills-opt-in');
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });
  const { default: main, work } = world.profiles;
  writeHudConfig(main, { lineLayout: 'pills' });
  writeHudConfig(work, PILLS);

  const plainFont = runStatusline(world, main, stdin, { columns: 220 });
  assert.equal(plainFont.status, 0);
  assert.equal(plainFont.stderr, '');
  assert.equal(plainFont.pillLines.length, 1, plainFont.plain);
  assert.doesNotMatch(plainFont.stdout, /[\ue000-\uf8ff]/u, 'without pillCaps no glyph needs a Nerd Font');
  for (const piece of [' Opus 5.5 medium │ ◔ ', ' 7% 69.0k/1.0M ', ' ◷ 5h ', ' 42% │ ', ' ▦ 7d ', ' 8% │ ', ' ▣ acme-app │ ◆ main ↑2 ↓1 +1 ~1 ?2 ']) {
    assert.ok(plainFont.plainLines[0].includes(piece), `${JSON.stringify(piece)} missing from ${JSON.stringify(plainFont.plainLines[0])}`);
  }
  assert.ok(plainFont.stdout.includes(LIGHT_BLUE_BG), 'the light Claude Code theme picks the light palette');
  assert.ok(!plainFont.stdout.includes(DARK_BLUE_BG));
  assert.doesNotMatch(plainFont.plain, /✓ Read/, 'the tools line stays off under the pills too');

  const nerdFont = runStatusline(world, work, stdin, { columns: 220 });
  assert.equal(nerdFont.stderr, '');
  assert.ok(nerdFont.stdout.includes(CAP_LEFT) && nerdFont.stdout.includes(CAP_RIGHT));
  assert.ok(nerdFont.stdout.includes(DARK_BLUE_BG), 'dark-ansi picks the dark palette');
  assert.ok(!nerdFont.stdout.includes(LIGHT_BLUE_BG));
});

test('the bun launcher renders the same row from src/index.ts', { skip: skip || (bunPath ? false : 'bun is not installed') }, () => {
  const { world, repo } = freshInstall('bun');
  const profile = world.profiles.work;
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });
  const viaNode = runStatusline(world, profile, stdin, { columns: 220 });
  applySetup(profile, setupCommand('bun', bunPath));
  const viaBun = runStatusline(world, profile, stdin, { columns: 220 });

  assert.equal(viaBun.status, 0);
  assert.equal(viaBun.stderr, '');
  assert.equal(viaBun.plainLines[0], viaNode.plainLines[0]);
  assert.doesNotMatch(viaBun.stdout, /STALE BUILD/);
});

test('every pill row fits the pane at each width in both palettes', { skip }, () => {
  const { world, repo } = pillsInstall('widths');
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });
  for (const profile of Object.values(world.profiles)) {
    for (const columns of [240, 160, 120, 100, 80, 60, 44, 30, 16]) {
      const run = runStatusline(world, profile, stdin, { columns });
      const label = `${profile.name} at ${columns}`;

      assert.equal(run.status, 0, label);
      assert.equal(run.stderr, '', label);
      assert.ok(run.pillLines.length >= 1, label);
      for (const line of run.pillLines) {
        assert.ok(visibleWidth(line) <= columns - 4, `${label}: ${visibleWidth(line)} cells`);
      }
      const text = run.pillLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '')).join('\n');
      if (columns >= 44) {
        for (const piece of ['Opus 5.5', '7%', '5h', '42%', '7d', '8%', 'main']) assert.ok(text.includes(piece), `${label}: ${piece}`);
      }
      if (columns >= 240) assert.equal(run.pillLines.length, 1, label);
      if (columns <= 100) assert.ok(run.pillLines.length >= 2, label);
    }
  }
});

test('a single pill on a narrow pane is clipped, never dropped', { skip }, () => {
  const { world } = pillsInstall('narrow');
  const run = runStatusline(world, world.profiles.default, { model: { display_name: 'Opus' } }, { columns: 14 });

  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.equal(run.pillLines.length, 1, JSON.stringify(run.stdout));
  assert.ok(visibleWidth(run.pillLines[0]) <= 10);
});

test('stdin without rate limits, effort or context still renders a sane row', { skip }, () => {
  const { world } = pillsInstall('sparse');
  const profile = world.profiles.work;
  const plainDir = path.join(world.root, 'plain-dir');
  mkdirSync(plainDir, { recursive: true });

  const sparse = runStatusline(world, profile, { model: { display_name: 'Opus' }, cwd: plainDir }, { columns: 160 });
  assert.equal(sparse.status, 0);
  assert.equal(sparse.stderr, '');
  assert.equal(sparse.pillLines.length, 1);
  assert.match(sparse.plainLines[0], /^. Opus │ ◔ — . . . plain-dir .$/u);
  assert.doesNotMatch(sparse.plain, /5h|7d|undefined|NaN|null/);
  assert.equal(existsSync(path.join(profile.dataDir, 'pr-cache')), false, 'no PR lookup outside a git repo');

  const empty = runStatusline(world, profile, {}, { columns: 160 });
  assert.equal(empty.status, 0);
  assert.equal(empty.stderr, '');
  assert.match(empty.plainLines[0], /^. Unknown │ ◔ — .$/u);

  const zeroWindow = runStatusline(
    world,
    profile,
    { model: { display_name: 'Opus' }, context_window: { context_window_size: 0, current_usage: null }, rate_limits: null, effort: null },
    { columns: 160 },
  );
  assert.equal(zeroWindow.status, 0);
  assert.equal(zeroWindow.stderr, '');
  assert.doesNotMatch(zeroWindow.plain, /undefined|NaN|null|Infinity/);

  const garbage = runStatusline(world, profile, '{not json', { columns: 160 });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stderr, '');
  assert.match(garbage.stdout, /Initializing/);

  const missingDir = runStatusline(world, profile, { model: { display_name: 'Opus' }, cwd: path.join(world.root, 'gone') }, { columns: 160 });
  assert.equal(missingDir.status, 0);
  assert.equal(missingDir.stderr, '');
  assert.equal(missingDir.pillLines.length, 1);
});

test('the PR badge arrives from gh in the background and never delays the row', { skip }, async () => {
  const { world, repo } = pillsInstall('pr');
  const profile = world.profiles.work;
  const gh = writeGhStub(world, {
    view: { number: 1234, state: 'OPEN', isDraft: false, headRefName: 'main', baseRefName: 'main' },
    pull: { number: 1234, state: 'open', merged: false, draft: false, mergeable_state: 'clean', head: { ref: 'main', sha: 'abc123' }, base: { ref: 'main' } },
    checks: { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }] },
  });
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });

  const before = runStatusline(world, profile, stdin, { columns: 240, ghDir: gh.dir });
  assert.equal(before.status, 0);
  assert.equal(before.stderr, '');
  assert.doesNotMatch(before.plain, /#1234/);

  await settlePr(profile);
  const after = runStatusline(world, profile, stdin, { columns: 240, ghDir: gh.dir });
  assert.equal(after.stderr, '');
  assert.ok(after.plainLines[0].includes('main #1234 ● ready ◷ 1 running ↓1 main │ ↑2 ↓1 +1 ~1 ?2 '), after.plainLines[0]);
  assert.deepEqual(gh.calls().slice(0, 3), [
    'pr view --json number,state,isDraft,headRefName,baseRefName',
    'api repos/{owner}/{repo}/pulls/1234 -i',
    'api repos/{owner}/{repo}/commits/abc123/check-runs?per_page=100 -i',
  ]);
  for (const name of listDir(path.join(profile.dataDir, 'pr-cache'))) {
    assert.equal(statSync(path.join(profile.dataDir, 'pr-cache', name)).mode & 0o077, 0, name);
  }
});

test('a branch without a PR is asked about once a minute, not on every repaint', { skip }, async () => {
  const { world, repo } = freshInstall('no-pr');
  const profile = world.profiles.work;
  const gh = writeGhStub(world, {});
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });

  runStatusline(world, profile, stdin, { columns: 200, ghDir: gh.dir });
  await settlePr(profile);
  const asked = gh.calls().length;
  assert.equal(asked, 1);
  for (let i = 0; i < 4; i++) {
    const run = runStatusline(world, profile, stdin, { columns: 200, ghDir: gh.dir });
    assert.equal(run.stderr, '');
    assert.equal(prLocks(profile).length, 0, 'no refresher was spawned for a fresh no-PR answer');
  }
  assert.equal(gh.calls().length, asked);
});

test('a hanging gh never holds up the statusline', { skip }, () => {
  const { world, repo } = pillsInstall('slow-gh');
  const profile = world.profiles.default;
  const dir = path.join(world.root, 'slow-gh');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'gh'), '#!/bin/sh\nexec sleep 45\n');
  chmodSync(path.join(dir, 'gh'), 0o755);
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });
  runStatusline(world, profile, stdin, { columns: 200, ghDir: dir });
  const run = runStatusline(world, profile, stdin, { columns: 200, ghDir: dir });

  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.ok(run.ms < 20_000, `render took ${run.ms}ms while gh sleeps for 45s`);
  assert.ok(run.plainLines[0].includes('main ↑2 ↓1 +1 ~1 ?2 '));
});

test('without gh or outside git the row still renders with no stderr', { skip }, async () => {
  const { world, repo } = pillsInstall('no-gh');
  const profile = world.profiles.default;
  const bin = toolBin(world, [...LAUNCHER_TOOLS, 'git']);
  assert.notEqual(spawnSync('sh', ['-c', 'command -v gh'], { env: { PATH: bin } }).status, 0, 'gh is unreachable');
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });

  const inRepo = runStatusline(world, profile, stdin, { columns: 200, path: bin, settled: (run) => run.plain.includes('acme-app │ ') });
  assert.equal(inRepo.status, 0);
  assert.equal(inRepo.stderr, '');
  assert.ok(inRepo.plainLines[0].includes('acme-app │ '), inRepo.plainLines[0]);
  await settlePr(profile);
  const snapshot = JSON.parse(readFileSync(path.join(profile.dataDir, 'pr-cache', prSnapshotFiles(profile)[0]), 'utf8'));
  assert.equal(snapshot.pr, null);
  const again = runStatusline(world, profile, stdin, { columns: 200, path: bin });
  assert.equal(again.stderr, '');
  assert.doesNotMatch(again.plain, /#\d/);

  const noGit = toolBin(world, LAUNCHER_TOOLS, 'bin-no-git');
  const bare = runStatusline(world, profile, stdin, { columns: 200, path: noGit });
  assert.equal(bare.status, 0);
  assert.equal(bare.stderr, '');
  assert.equal(bare.pillLines.length, 1);
  assert.ok(bare.plainLines[0].includes(' Opus 5.5 medium │ ◔ '));
});

test('a linked worktree shows its own folder, branch and counts', { skip }, () => {
  const { world, repo } = pillsInstall('worktree');
  const stdin = stdinFor({ cwd: repo.worktree, transcriptPath: writeTranscript(world).transcriptPath });
  const run = runStatusline(world, world.profiles.work, stdin, { columns: 220 });

  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.ok(run.plainLines[0].includes('acme-app-feature │ '), run.plainLines[0]);
  assert.ok(run.plainLines[0].includes('feature/pills ?1 '), run.plainLines[0]);
});

test('pillCaps and pillTheme are honoured from a hand-written config', { skip }, () => {
  const { world, repo } = pillsInstall('options');
  const profile = world.profiles.work;
  mkdirSync(profile.dataDir, { recursive: true });
  writeFileSync(path.join(profile.dataDir, 'config.json'), JSON.stringify({ lineLayout: 'pills', display: { pillCaps: false, pillTheme: 'light', pillPr: false } }));
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });
  const run = runStatusline(world, profile, stdin, { columns: 220 });

  assert.equal(run.stderr, '');
  assert.ok(!run.stdout.includes(CAP_LEFT) && !run.stdout.includes(CAP_RIGHT), 'square pills need no Nerd Font caps');
  assert.ok(run.stdout.includes(LIGHT_BLUE_BG), 'pillTheme overrides the dark Claude Code theme');
  assert.equal(existsSync(path.join(profile.dataDir, 'pr-cache')), false, 'pillPr off never spawns gh');
});

test('a theme that is neither light nor dark falls back to the dark palette', { skip }, () => {
  const { world, repo } = pillsInstall('themes', { default: 'custom:orca', work: 'light-daltonized' });
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });

  assert.ok(runStatusline(world, world.profiles.default, stdin, { columns: 220 }).stdout.includes(DARK_BLUE_BG));
  assert.ok(runStatusline(world, world.profiles.work, stdin, { columns: 220 }).stdout.includes(LIGHT_BLUE_BG));
});

test('a running subagent gets its own row, from its transcript and from the subagentStatusLine feed', { skip }, () => {
  const { world, repo } = pillsInstall('agents');
  const profile = world.profiles.work;
  const bridge = path.join(world.root, 'subagent-bridge.sh');
  writeFileSync(
    bridge,
    [
      '#!/bin/sh',
      'dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/usage-band"',
      'in=$(cat)',
      'id=$(printf \'%s\' "$in" | sed -n \'s/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -n 1)',
      'mkdir -p "$dir" || exit 0',
      'printf \'%s\' "$in" > "$dir/sa-$id.json"',
      '',
    ].join('\n'),
  );
  chmodSync(bridge, 0o755);
  writeSettings(profile, { subagentStatusLine: { type: 'command', command: bridge } });
  const transcript = writeTranscript(world, {
    agents: [
      { id: 'a1b2c3', toolUseId: 'toolu_agent_1', type: 'Explore', modelId: 'claude-haiku-4-5', effort: 'low', tokens: 30000 },
      { id: 'd4e5f6', toolUseId: 'toolu_agent_2', type: 'general-purpose', modelId: 'claude-sonnet-5', effort: 'high', tokens: 50000, worktreePath: repo.worktree },
    ],
  });
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: transcript.transcriptPath, sessionId: transcript.sessionId });

  const fromTranscript = runStatusline(world, profile, stdin, { columns: 240 });
  assert.equal(fromTranscript.status, 0);
  assert.equal(fromTranscript.stderr, '');
  assert.equal(fromTranscript.pillLines.length, 3, fromTranscript.plain);
  assert.ok(fromTranscript.plainLines[1].includes(' ↳ Explore · Haiku 4.5 low │ ◔ '), fromTranscript.plainLines[1]);
  assert.ok(fromTranscript.plainLines[1].endsWith('│ ◔ 30.0k \ue0b4'), fromTranscript.plainLines[1]);
  assert.doesNotMatch(fromTranscript.plainLines[1], /%|200\.0k/, 'an unknown window is never guessed');
  assert.ok(fromTranscript.plainLines[2].includes(' ↳ general-purpose · Sonnet 5 high │ ◔ '), fromTranscript.plainLines[2]);
  assert.ok(fromTranscript.plainLines[2].includes('acme-app-feature │ '), fromTranscript.plainLines[2]);
  assert.ok(fromTranscript.plainLines[2].includes('feature/pills ?1 '), fromTranscript.plainLines[2]);
  assert.doesNotMatch(fromTranscript.plain, /◐ Explore/, 'the agent pills replace the agents line');

  const feed = {
    session_id: transcript.sessionId,
    transcript_path: transcript.transcriptPath,
    cwd: repo.repo,
    columns: 240,
    tasks: [
      { id: 'a1b2c3', type: 'local_agent', agentType: 'Explore', status: 'running', model: 'claude-opus-5-5', contextWindowSize: 1_000_000, tokenCount: 120_000 },
    ],
  };
  const bridged = spawnSync('sh', ['-c', readSettings(profile).subagentStatusLine.command], {
    input: JSON.stringify(feed),
    env: { ...process.env, HOME: world.home, ...profile.env },
    encoding: 'utf8',
  });
  assert.equal(bridged.status, 0);
  assert.equal(bridged.stdout, '');
  assert.ok(existsSync(path.join(profile.configDir, 'usage-band', `sa-${transcript.sessionId}.json`)));

  const fromFeed = runStatusline(world, profile, stdin, { columns: 240 });
  assert.equal(fromFeed.stderr, '');
  assert.ok(fromFeed.plainLines[1].includes(' ↳ Explore · Opus 5.5 low │ ◔ '), fromFeed.plainLines[1]);
  assert.ok(fromFeed.plainLines[1].includes(' 12% 120.0k/1.0M '), fromFeed.plainLines[1]);
  assert.doesNotMatch(fromFeed.plainLines[2], /%/, 'no feed has reported a Sonnet window yet');

  writeFileSync(
    path.join(profile.configDir, 'usage-band', 'sa-99999999-0000-4000-8000-000000000000.json'),
    JSON.stringify({ session_id: 'another', tasks: [{ id: 'zz', model: 'claude-sonnet-5', contextWindowSize: 1_000_000, tokenCount: 1 }] }),
  );
  const learned = runStatusline(world, profile, stdin, { columns: 240 });
  assert.equal(learned.stderr, '');
  assert.ok(learned.plainLines[2].includes(' 5% 50.0k/1.0M '), learned.plainLines[2]);

  const narrow = runStatusline(world, profile, stdin, { columns: 34 });
  assert.equal(narrow.stderr, '');
  assert.ok(narrow.plain.includes('↳ Explore'), 'the agent row survives a narrow pane');
  for (const line of narrow.pillLines) assert.ok(visibleWidth(line) <= 30);

  const other = runStatusline(world, world.profiles.default, stdin, { columns: 240 });
  assert.ok(other.plainLines[1].includes(' ↳ Explore · Haiku 4.5 low │ ◔ '), 'another profile never reads this profile\'s feed');
  assert.doesNotMatch(other.plainLines[1], /%/);
  assert.doesNotMatch(other.plainLines[2], /%/);
});

test('the latest installed version wins across marketplaces and non-version folders', { skip }, () => {
  const world = createWorld('versions');
  const profile = world.profiles.work;
  installPlugin(profile, { real: '0.10.0', stubs: ['0.9.9', '0.2.38'] });
  installPlugin(profile, { marketplace: 'another-marketplace', real: '0.9.10', stubs: ['0.1.7'], copy: true });
  const real = path.join(profile.cacheDir, 'another-marketplace', 'claude-hud-enhanced', '0.9.10', 'dist', 'index.js');
  writeFileSync(real, "console.log('STALE BUILD 0.9.10');\n");
  applySetup(profile, setupCommand('node', process.execPath));
  writeHudConfig(profile, PILLS);
  const run = runStatusline(world, profile, { model: { display_name: 'Opus' } }, { columns: 120 });

  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.doesNotMatch(run.stdout, /STALE BUILD/);
  assert.equal(run.pillLines.length, 1);
});

test('the launcher falls back to 120 columns when Claude Code passes none', { skip }, () => {
  const { world, repo } = freshInstall('columns');
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });
  const run = runStatusline(world, world.profiles.default, stdin, {});

  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.ok(run.lines.length >= 2);
  for (const line of run.lines) assert.ok(visibleWidth(line) <= 116, `${visibleWidth(line)} cells`);
});

const usageFiles = (profile) => listDir(profile.dataDir).filter((name) => name.includes('usage-snapshot'));
const readUsageSnapshot = (profile) => JSON.parse(readFileSync(path.join(profile.dataDir, 'usage-snapshot.json'), 'utf8'));

function seedUsage(profile, snapshot) {
  mkdirSync(profile.dataDir, { recursive: true });
  const at = new Date(Date.now() - 5_000).toISOString();
  writeFileSync(
    path.join(profile.dataDir, 'usage-snapshot.json'),
    JSON.stringify({ updated_at: at, oauth_updated_at: at, source: 'oauth', status: 'ok', next_attempt_at: null, ...snapshot(at) }),
  );
}

test('every session of a profile shows the newest usage reading, never an idle session\'s old one', { skip }, () => {
  const { world, repo } = pillsInstall('fresh-usage');
  for (const profile of Object.values(world.profiles)) {
    const active = writeTranscript(world, { sessionId: '11111111-2222-4333-8444-aaaaaaaaaaaa', project: `${profile.name}-a` });
    const idle = writeTranscript(world, { sessionId: '11111111-2222-4333-8444-bbbbbbbbbbbb', project: `${profile.name}-b` });
    const now = Date.now();
    const at = (percent, transcript) =>
      stdinFor({
        cwd: repo.repo,
        transcriptPath: transcript.transcriptPath,
        sessionId: transcript.sessionId,
        now,
        extra: {
          rate_limits: {
            five_hour: { used_percentage: percent, resets_at: Math.floor((now + 2 * 3_600_000) / 1000) },
            seven_day: { used_percentage: 8, resets_at: Math.floor((now + 3 * 24 * 3_600_000) / 1000) },
          },
        },
      });
    const five = (run) => / 5h [^%]* (\d+)%/.exec(run.plainLines[0])?.[1];

    assert.equal(five(runStatusline(world, profile, at(42, idle), { columns: 240 })), '42');
    assert.equal(five(runStatusline(world, profile, at(42, active), { columns: 240 })), '42');
    assert.equal(five(runStatusline(world, profile, at(55, active), { columns: 240 })), '55', 'the active session moves on');
    const stale = runStatusline(world, profile, at(42, idle), { columns: 240 });
    assert.equal(stale.stderr, '');
    assert.equal(five(stale), '55', `${profile.name}: the idle session shows the newer reading`);
    assert.equal(readUsageSnapshot(profile).five_hour.used_percentage, 55, 'and did not write its own back');
    assert.equal(five(runStatusline(world, profile, at(42, idle), { columns: 240 })), '55');
    assert.equal(five(runStatusline(world, profile, at(57, idle), { columns: 240 })), '57', 'until it has a newer one itself');
    assert.equal(five(runStatusline(world, profile, at(55, active), { columns: 240 })), '57');
  }
  const personal = readUsageSnapshot(world.profiles.default);
  const work = readUsageSnapshot(world.profiles.work);
  assert.equal(personal.five_hour.used_percentage, 57);
  assert.equal(work.five_hour.used_percentage, 57);
  assert.notEqual(path.dirname(world.profiles.default.dataDir), path.dirname(world.profiles.work.dataDir), 'each profile keeps its own snapshot');
});

test('the windows the usage API reported are shown as they are: no invented 5h, extra usage while in use', { skip }, () => {
  const { world, repo } = pillsInstall('api-usage');
  const { default: personal, work: team } = world.profiles;
  const weekAhead = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString();
  seedUsage(personal, (seenAt) => ({
    five_hour: { used_percentage: null, resets_at: null, seen_at: seenAt },
    seven_day: { used_percentage: 61, resets_at: weekAhead, seen_at: seenAt },
    extra_usage: { enabled: true, utilization: 24.8, used: 1240, limit: 5000 },
  }));
  seedUsage(team, (seenAt) => ({
    five_hour: { used_percentage: null, resets_at: null, seen_at: seenAt },
    seven_day: { used_percentage: null, resets_at: null, seen_at: seenAt },
    extra_usage: { enabled: true, utilization: 0, used: 0, limit: 5000 },
  }));
  const transcript = writeTranscript(world);
  const weeklyOnly = stdinFor({
    cwd: repo.repo,
    transcriptPath: transcript.transcriptPath,
    extra: { rate_limits: { seven_day: { used_percentage: 58, resets_at: Math.floor(Date.parse(weekAhead) / 1000) } } },
  });

  const max = runStatusline(world, personal, weeklyOnly, { columns: 240 });
  assert.equal(max.stderr, '');
  assert.doesNotMatch(max.plainLines[0], /5h|no limit|◷/, 'the plan has no 5h window: no pill is drawn for it');
  assert.doesNotMatch(max.plainLines[0], /5h[^▦]*%/);
  assert.match(max.plainLines[0], / 7d [^%~]* 61% /);
  assert.ok(max.plainLines[0].includes(' $ ━━━━━━━━ 12.40/$50 '), max.plainLines[0]);
  assert.ok(max.plainLines[0].indexOf('7d') < max.plainLines[0].indexOf('12.40'));
  assert.ok(max.plainLines[0].indexOf('12.40') < max.plainLines[0].indexOf('acme-app'));
  for (const columns of [120, 80, 50, 30]) {
    const narrow = runStatusline(world, personal, weeklyOnly, { columns });
    assert.ok(narrow.plain.includes('12.40'), `${columns} columns keeps the amount`);
    for (const line of narrow.pillLines) assert.ok(visibleWidth(line) <= columns - 4, `${columns} columns`);
  }
  writeFileSync(path.join(personal.dataDir, 'config.json'), JSON.stringify({ lineLayout: 'compact' }));
  const compact = runStatusline(world, personal, weeklyOnly, { columns: 240 });
  assert.equal(compact.stderr, '');
  assert.ok(compact.plain.includes('extra $12.40/$50'), compact.plain);
  assert.doesNotMatch(compact.plain, /5h/);

  const live = stdinFor({ cwd: repo.repo, transcriptPath: transcript.transcriptPath });
  const fallback = runStatusline(world, team, live, { columns: 240 });
  assert.equal(fallback.stderr, '');
  assert.match(fallback.plainLines[0], / 5h [^%]* ~42% · unconfirmed /, 'the API had no personal windows: stdin fills the bars, marked as not confirmed');
  assert.match(fallback.plainLines[0], / 7d [^%]* ~8% · unconfirmed /);
  assert.doesNotMatch(fallback.plainLines[0], /no limit/);
  assert.doesNotMatch(fallback.plainLines[0], /\$/, 'enabled but unused extra usage is not shown');
  const moved = stdinFor({ cwd: repo.repo, transcriptPath: transcript.transcriptPath, extra: { rate_limits: { five_hour: { used_percentage: 43, resets_at: live.rate_limits.five_hour.resets_at }, seven_day: live.rate_limits.seven_day } } });
  assert.match(runStatusline(world, team, moved, { columns: 240 }).plainLines[0], / 5h [^%~]* 43% │ /, 'once the figure moves it has been observed');
  assert.equal(readUsageSnapshot(team).five_hour.used_percentage, null, 'the API answer is left as it was');
});

test('API-key sessions are never polled, and a signed-out profile keeps its stdin bars', { skip }, async () => {
  const { world, repo } = pillsInstall('no-oauth');
  const { default: keyed, work: signedOut } = world.profiles;
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });

  const withKey = runStatusline(world, keyed, stdin, { columns: 240, env: { ANTHROPIC_API_KEY: 'sk-test-not-a-real-key' } });
  assert.equal(withKey.status, 0);
  assert.equal(withKey.stderr, '');
  assert.equal(withKey.pillLines.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.ok(!usageFiles(keyed).includes('.usage-snapshot.lock'), 'no refresher was started');
  if (usageFiles(keyed).includes('usage-snapshot.json')) {
    assert.equal(readUsageSnapshot(keyed).next_attempt_at, null, 'and nothing was attempted');
    assert.equal(readUsageSnapshot(keyed).status, 'ok');
  }

  const first = runStatusline(world, signedOut, stdin, { columns: 240 });
  assert.equal(first.stderr, '');
  const settled = await waitFor(() => usageFiles(signedOut).includes('usage-snapshot.json') && readUsageSnapshot(signedOut).status === 'auth_expired' && !usageFiles(signedOut).includes('.usage-snapshot.lock'));
  assert.ok(settled, 'the refresher found no login, said so and released its lock');
  const snapshot = readUsageSnapshot(signedOut);
  const wait = Date.parse(snapshot.next_attempt_at) - Date.now();
  assert.ok(wait > 60_000 && wait <= 2 * 60_000 * 1.25 + 1_000, `it tries again in about two minutes, not every repaint (${wait}ms)`);
  assert.equal(snapshot.five_hour.used_percentage, 42, 'the stdin reading is kept');
  const again = runStatusline(world, signedOut, stdin, { columns: 240 });
  assert.equal(again.stderr, '');
  assert.match(again.plainLines[0], / 5h [^%~]* 42% /);
  assert.match(again.plainLines[0], / 7d [^%~]* 8% /);
  assert.ok(!usageFiles(signedOut).includes('.usage-snapshot.lock'), 'no second refresher inside the back-off');
});

test('a reading the poll has not confirmed for minutes is dimmed with its age, and a passed reset reads 0%', { skip }, () => {
  const { world, repo } = pillsInstall('aged-usage');
  const profile = world.profiles.work;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  mkdirSync(profile.dataDir, { recursive: true });
  writeFileSync(
    path.join(profile.dataDir, 'usage-snapshot.json'),
    JSON.stringify({
      updated_at: iso(now - 4 * 60_000),
      oauth_updated_at: iso(now - 4 * 60_000),
      source: 'oauth',
      status: 'rate_limited',
      next_attempt_at: iso(now + 10 * 60_000),
      five_hour: { used_percentage: 16, resets_at: iso(now + 2 * 3_600_000), seen_at: iso(now - 4 * 60_000) },
      seven_day: { used_percentage: 77, resets_at: iso(now - 60_000), seen_at: iso(now - 4 * 60_000) },
    }),
  );
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath, extra: { rate_limits: null } });
  const run = runStatusline(world, profile, stdin, { columns: 240 });

  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  assert.match(run.plainLines[0], / ◷ 5h [^%]* ~16% · 4m ago │ /, 'kept on screen, marked with its age');
  assert.match(run.plainLines[0], / ▦ 7d [^%]* ~0% · reset │ /, 'the weekly window that ended reads 0%');
  assert.equal(listDir(profile.dataDir).includes('.usage-snapshot.lock'), false, 'the server-requested pause is respected');
  for (const columns of [100, 60, 30]) {
    const narrow = runStatusline(world, profile, stdin, { columns });
    assert.ok(narrow.plain.includes('~16%'), `${columns} columns`);
    for (const line of narrow.pillLines) assert.ok(visibleWidth(line) <= columns - 4, `${columns} columns`);
  }
});

test('a crowded row through the real launcher keeps every pill whole at each pane width', { skip }, async () => {
  const { world, repo } = pillsInstall('crowded');
  const profile = world.profiles.work;
  const gh = writeGhStub(world, {
    view: { number: 1971, state: 'OPEN', isDraft: false, headRefName: 'feature/pills', baseRefName: 'main' },
    pull: { number: 1971, state: 'open', merged: false, draft: false, mergeable_state: 'unstable', head: { ref: 'feature/pills', sha: 'abc123' }, base: { ref: 'main' } },
    checks: { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }] },
  });
  const weekAhead = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString();
  const seenLongAgo = new Date(Date.now() - 4 * 60_000).toISOString();
  seedUsage(profile, (seenAt) => ({
    status: 'rate_limited',
    next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    five_hour: { used_percentage: 16, resets_at: new Date(Date.now() + 2 * 3_600_000).toISOString(), seen_at: seenLongAgo },
    seven_day: { used_percentage: 58, resets_at: weekAhead, seen_at: seenAt },
    model_scoped: [{ display_name: 'Fable', utilization: 30, resets_at: weekAhead }],
    extra_usage: { enabled: true, utilization: 24.8, used: 1240, limit: 5000, currency: 'USD', decimals: 2 },
  }));
  const stdin = stdinFor({ cwd: repo.worktree, transcriptPath: writeTranscript(world).transcriptPath, extra: { rate_limits: null } });
  runStatusline(world, profile, stdin, { columns: 204, ghDir: gh.dir });
  await settlePr(profile);

  for (const columns of [40, 52, 60, 80, 100, 120, 200]) {
    const run = runStatusline(world, profile, stdin, { columns: columns + 4, ghDir: gh.dir, settled: (r) => r.plain.includes('#1971') });
    const label = `${columns} columns`;
    assert.equal(run.status, 0, label);
    assert.equal(run.stderr, '', label);
    const lines = run.pillLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ''));
    const text = lines.join('\n');
    for (const line of lines) {
      assert.ok([...line].length <= columns, `${label}: ${[...line].length} cells: ${JSON.stringify(line)}`);
      assert.ok(line.startsWith(CAP_LEFT) && line.endsWith(CAP_RIGHT), `${label}: a cap is missing: ${JSON.stringify(line)}`);
      assert.equal(line.split(CAP_LEFT).length, line.split(CAP_RIGHT).length, `${label}: a pill is split across rows`);
      assert.doesNotMatch(line, /[│·]\s*(|$)/u, `${label}: dangling separator: ${JSON.stringify(line)}`);
    }
    for (const piece of ['Opus 5.5', '~16%', '58%', '▦ Fable ', '30%', '12.40', '#1971']) assert.ok(text.includes(piece), `${label}: ${piece}`);
    assert.doesNotMatch(text, /Fable 7d/, label);
    assert.ok(text.indexOf(' 5h ') < text.indexOf('▦ Fable ') && text.indexOf('▦ Fable ') < text.indexOf('▦ 7d '), `${label}: 5h, Fable, 7d in order: ${JSON.stringify(lines)}`);
    assert.ok(lines.some((line) => line.includes('feat') && line.includes('#1971')), `${label}: branch and PR share a row: ${JSON.stringify(lines)}`);
    if (columns >= 120) assert.ok(text.includes("feature/pills"), `${label}: the branch name is whole`);
    if (columns >= 52) assert.ok(lines.some((line) => line.split(CAP_LEFT).length - 1 >= 2), `${label}: short pills sit side by side`);
    if (columns >= 52) assert.ok(lines.length <= 5, `${label}: ${lines.length} rows`);
    if (columns >= 200) assert.ok(lines.length <= 2, `${label}: ${lines.length} rows`);
    if (columns >= 80) assert.ok(text.includes('1 running'), `${label}: running checks`);
  }
});

test('the default layout through the real launcher shows every new reading and fits each pane width', { skip }, async () => {
  const { world, repo } = freshInstall('compact-crowded');
  const profile = world.profiles.work;
  const gh = writeGhStub(world, {
    view: { number: 1971, state: 'OPEN', isDraft: false, headRefName: 'feature/pills', baseRefName: 'main' },
    pull: { number: 1971, state: 'open', merged: false, draft: false, mergeable_state: 'unstable', head: { ref: 'feature/pills', sha: 'abc123' }, base: { ref: 'main' } },
    checks: { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }] },
  });
  const weekAhead = new Date(Date.now() + 3 * 24 * 3_600_000).toISOString();
  const seenLongAgo = new Date(Date.now() - 4 * 60_000).toISOString();
  seedUsage(profile, (seenAt) => ({
    status: 'rate_limited',
    next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    five_hour: { used_percentage: null, resets_at: null, seen_at: seenAt },
    seven_day: { used_percentage: 58, resets_at: weekAhead, seen_at: seenLongAgo },
    model_scoped: [{ display_name: 'Fable', utilization: 30, resets_at: weekAhead }],
    extra_usage: { enabled: true, utilization: 24.8, used: 1240, limit: 5000, currency: 'USD', decimals: 2 },
  }));
  const stdin = stdinFor({ cwd: repo.worktree, transcriptPath: writeTranscript(world).transcriptPath, extra: { rate_limits: null } });
  runStatusline(world, profile, stdin, { columns: 204, ghDir: gh.dir });
  await settlePr(profile);

  const wide = runStatusline(world, profile, stdin, { columns: 204, ghDir: gh.dir, settled: (r) => r.plain.includes('#1971') });
  assert.equal(wide.stderr, '');
  assert.equal(existsSync(path.join(profile.dataDir, 'config.json')), false, 'this is the layout with no config at all');
  assert.match(wide.plainLines[0], /^\[Opus 5\.5 \(1M context\) medium \| Max 20x\] █░+ 7% \(69k\/1\.0M\) \| acme-app-feature wt:\(feature\/pills\* \?1\) #1971 ◷ 1 running/);
  assert.match(wide.plainLines[1], /^Fable ███░+ 30% \| Weekly ██████░+ ~58% · 4m ago \(resets [^)]+\) \| extra \$12\.40\/\$50$/);

  for (const columns of [40, 60, 80, 100, 120, 200]) {
    const run = runStatusline(world, profile, stdin, { columns: columns + 4, ghDir: gh.dir, settled: (r) => r.plain.includes('acme-app-feature') });
    const label = `${columns} columns: ${JSON.stringify(run.plainLines)}`;

    assert.equal(run.status, 0, label);
    assert.equal(run.stderr, '', label);
    assert.equal(run.plainLines.length, 2, label);
    for (const line of run.lines) assert.ok(visibleWidth(line) <= columns, `${visibleWidth(line)} cells at ${label}`);
    assert.doesNotMatch(run.stdout, /\x1b\[[34]8;2;|[\ue000-\uf8ff]/u, label);
    assert.doesNotMatch(run.plain, /5h|--|✓ Read|\.\.\./, label);
    for (const piece of ['Opus 5.5', '7%', 'acme-app-feature', 'Fable', '30%', '~58%', '$12.40']) assert.ok(run.plain.includes(piece), `${piece} at ${label}`);
    assert.ok(run.plainLines[1].indexOf('Fable') < run.plainLines[1].search(/Weekly|7d:/), label);
    if (columns >= 80) assert.ok(run.plain.includes('· 4m ago'), label);
    if (columns >= 120) assert.ok(run.plain.includes('wt:(feature/pills*') && run.plain.includes('#1971'), label);
  }
});

test('the activity lines stay off for a config written before the update and come back with the new keys', { skip }, () => {
  const { world, repo } = freshInstall('activity-keys');
  const profile = world.profiles.work;
  const stdin = stdinFor({ cwd: repo.repo, transcriptPath: writeTranscript(world).transcriptPath });
  const render = (config) => {
    if (config) writeHudConfig(profile, config);
    const run = runStatusline(world, profile, stdin, { columns: 200 });
    assert.equal(run.stderr, '');
    return run.plain;
  };

  assert.doesNotMatch(render(null), /✓ Read/, 'no config');
  assert.doesNotMatch(render({ display: { showTools: true, showAgents: true, showTodos: true } }), /✓ Read/, 'the old keys no longer turn the lines on');
  assert.doesNotMatch(render({ lineLayout: 'expanded', display: { showTools: true } }), /✓ Read/);
  assert.match(render({ display: { toolsLine: true } }), /✓ Read/);
  assert.match(render({ lineLayout: 'expanded', display: { toolsLine: true } }), /✓ Read/);
  assert.doesNotMatch(render({ display: { toolsLine: false, showTools: true } }), /✓ Read/);
});
