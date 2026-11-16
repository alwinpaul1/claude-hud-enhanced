import { testRoot } from './helpers/isolate-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, mergeConfig } from '../dist/config.js';
import { getBuildId, getPluginVersion } from '../dist/daemon-ipc.js';
import { GIT_CACHE_VERSION, getGitStatusCached } from '../dist/git-cache.js';
import { PR_IDLE_EVERY, PR_LIVE_EVERY, isPrSnapshot, prPaths, requestKey, resolvePrStatus } from '../dist/pr-status.js';
import { contextSpec, layout, paletteFor, renderPillBand } from '../dist/render/pills.js';

const tempDir = (label) => mkdtempSync(path.join(testRoot, `${label}-`));
const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');

test('mergeConfig gives pills to a config that never chose a layout and keeps one that did', () => {
  assert.equal(DEFAULT_CONFIG.lineLayout, 'pills');
  const cases = [
    [{}, 'pills'],
    [{ showSeparators: true, display: { usageCompact: true } }, 'pills'],
    [{ lineLayout: 'compact' }, 'compact'],
    [{ lineLayout: 'expanded' }, 'expanded'],
    [{ lineLayout: 'pills' }, 'pills'],
    [{ layout: 'default' }, 'compact'],
    [{ layout: 'separators' }, 'compact'],
    [{ layout: { lineLayout: 'expanded' } }, 'expanded'],
    [{ layout: { lineLayout: 'nope' } }, 'pills'],
    [{ layout: 'separators', lineLayout: 'expanded' }, 'expanded'],
    [{ lineLayout: 'COMPACT' }, 'pills'],
    [{ lineLayout: null }, 'pills'],
  ];
  for (const [config, expected] of cases) {
    assert.equal(mergeConfig(config).lineLayout, expected, JSON.stringify(config));
  }
  assert.equal(mergeConfig({ layout: 'separators' }).showSeparators, true);
  assert.equal(mergeConfig({ layout: 'default' }).showSeparators, false);
});

test('pill options fall back to their defaults on any bad value', () => {
  const merged = mergeConfig({ display: { pillTheme: 'neon', pillCaps: 'yes', pillPr: 0 } });
  assert.equal(merged.display.pillTheme, 'auto');
  assert.equal(merged.display.pillCaps, true);
  assert.equal(merged.display.pillPr, true);
  const chosen = mergeConfig({ display: { pillTheme: 'light', pillCaps: false, pillPr: false } });
  assert.deepEqual([chosen.display.pillTheme, chosen.display.pillCaps, chosen.display.pillPr], ['light', false, false]);
});

test('a lone pill that cannot fit is kept on its own row and clipped to the pane', () => {
  const palette = paletteFor('dark');
  const spec = contextSpec({ tokens: 69_000, window: 1_000_000, percent: 7 }, { name: 'Opus 5.5', effort: 'medium' }, palette);
  for (const columns of [30, 12, 6, 3]) {
    assert.equal(layout([spec], columns, 2).length, 1, `${columns} columns`);
    const rows = renderPillBand(
      { context: { tokens: 69_000, window: 1_000_000, percent: 7 }, model: { name: 'Opus 5.5', effort: 'medium' }, fiveHour: null, sevenDay: null, git: null, folder: null, agents: [] },
      columns,
      { palette, caps: true, now: 0 },
    );
    assert.equal(rows.length, 1, `${columns} columns`);
    assert.ok([...plain(rows[0])].length <= Math.max(columns, 2), `${columns} columns: ${JSON.stringify(plain(rows[0]))}`);
  }
});

test('a PR snapshot with the wrong shape is rejected before it can reach the renderer', () => {
  const good = { version: 1, at: 1, request: 'r', pr: { number: 7, state: 'OPEN', ready: 'clean', checks: { failing: 0, pending: 1, passing: 2 } }, own: { branch: 'b', ahead: 1, behind: 0 }, base: { name: 'main', ahead: 1, behind: 2 } };
  assert.equal(isPrSnapshot(good), true);
  assert.equal(isPrSnapshot({ version: 1, at: 1, request: 'r', pr: null }), true);
  const bad = [
    null,
    'text',
    { ...good, version: 2 },
    { ...good, at: '1' },
    { ...good, pr: { number: '7', state: 'OPEN' } },
    { ...good, pr: { number: 7, state: 'WEIRD' } },
    { ...good, pr: { number: 7, state: 'OPEN', ready: 'maybe' } },
    { ...good, pr: { number: 7, state: 'OPEN', checks: { failing: 'x' } } },
    { ...good, pr: { number: 7, state: 'OPEN', branch: 5 } },
    { ...good, own: { branch: 7, ahead: 0, behind: 0 } },
    { ...good, own: null },
    { ...good, base: 'main' },
    { ...good, base: { name: 'main', ahead: -1, behind: 0 } },
  ];
  for (const value of bad) assert.equal(isPrSnapshot(value), false, JSON.stringify(value));
});

test('a branch with no PR is re-checked once a minute, one with a PR every few seconds', () => {
  const homeDir = tempDir('pr-home');
  const request = { cwd: '/repo', session: '/t.jsonl', branch: 'main', named: null, sessionPr: null };
  const paths = prPaths(request, homeDir);
  mkdirSync(path.dirname(paths.snapshot), { recursive: true });
  let spawned = 0;
  const resolve = (now) =>
    resolvePrStatus(request, {
      now: () => now,
      homeDir,
      ensureDir: (dir) => mkdirSync(dir, { recursive: true }),
      spawnRefresher: (_req, p) => {
        spawned += 1;
        writeFileSync(p.lock, '');
        mkdirSync(path.dirname(p.lock), { recursive: true });
      },
      fs: {
        existsSync: () => false,
        statSync: () => ({ mtimeMs: 0 }),
        renameSync: () => undefined,
        rmSync: () => undefined,
        writeFileSync: () => undefined,
        readFileSync: () => '',
        mkdirSync: () => undefined,
        chmodSync: () => undefined,
      },
    });
  const at = 1_000_000;

  assert.equal(resolve(at), null);
  assert.equal(spawned, 1, 'no snapshot yet: refresh');

  writeFileSync(paths.snapshot, JSON.stringify({ version: 1, at, request: requestKey(request), pr: null }));
  assert.equal(resolve(at + PR_LIVE_EVERY + 1)?.pr, null);
  assert.equal(resolve(at + PR_IDLE_EVERY - 1)?.pr, null);
  assert.equal(spawned, 1, 'a fresh no-PR answer is not asked again');
  resolve(at + PR_IDLE_EVERY);
  assert.equal(spawned, 2);

  writeFileSync(paths.snapshot, JSON.stringify({ version: 1, at, request: requestKey(request), pr: { number: 9, state: 'OPEN' } }));
  assert.equal(resolve(at + PR_LIVE_EVERY - 1)?.pr?.number, 9);
  assert.equal(spawned, 2);
  resolve(at + PR_LIVE_EVERY);
  assert.equal(spawned, 3, 'a live PR refreshes on the short cadence');

  resolve(at - 10_000);
  assert.equal(spawned, 4, 'a snapshot stamped in the future is refreshed, not trusted forever');

  assert.equal(resolvePrStatus({ ...request, branch: 'other' }, {
    now: () => at + 1,
    homeDir,
    ensureDir: () => undefined,
    spawnRefresher: () => { spawned += 1; },
    fs: { existsSync: () => false, statSync: () => ({ mtimeMs: 0 }), renameSync: () => undefined, rmSync: () => undefined, writeFileSync: () => undefined, readFileSync: () => '', mkdirSync: () => undefined, chmodSync: () => undefined },
  }), null, 'a snapshot for another branch is never shown');
  assert.equal(spawned, 5);
});

test('a git cache entry from an older build or with a broken status is refetched', async () => {
  const homeDir = tempDir('git-home');
  const repo = tempDir('git-repo');
  mkdirSync(path.join(repo, '.git'));
  writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const fresh = { branch: 'main', isDirty: false, ahead: 0, behind: 0, worktree: 'git-repo', isLinked: false };
  let fetched = 0;
  const read = () => getGitStatusCached(repo, { homeDir, now: () => 5_000, random: () => 1, fetch: async () => { fetched += 1; return fresh; } });

  assert.deepEqual(await read(), fresh);
  assert.equal(fetched, 1);
  assert.deepEqual(await read(), fresh);
  assert.equal(fetched, 1, 'a current entry is served from the cache');

  const cacheDir = path.join(homeDir, '.claude', 'plugins', 'claude-hud-enhanced', 'git-cache');
  const file = path.join(cacheDir, readdirSync(cacheDir).find((name) => name.endsWith('.json')));
  const entry = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(entry.version, GIT_CACHE_VERSION);

  const stale = [
    { ...entry, version: 1, status: { branch: 'OLD', isDirty: false, ahead: 0, behind: 0 } },
    { ...entry, status: 'main' },
    { ...entry, status: { branch: 5, isDirty: false, ahead: 0, behind: 0 } },
    { ...entry, status: { branch: 'x' } },
    { ...entry, status: undefined },
  ];
  for (const [index, value] of stale.entries()) {
    writeFileSync(file, JSON.stringify(value));
    assert.deepEqual(await read(), fresh, JSON.stringify(value));
    assert.equal(fetched, index + 2, JSON.stringify(value));
  }
});

test('the daemon handshake id changes with the build, not only with the version', () => {
  const version = getPluginVersion();
  const id = getBuildId();
  assert.ok(id.startsWith(`${version}+`), id);
  assert.match(id.slice(version.length + 1), /^\d+\.\d+$/);
  assert.equal(getBuildId(), id);
});
