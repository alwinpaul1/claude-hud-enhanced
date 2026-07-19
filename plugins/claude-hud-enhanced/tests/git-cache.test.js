import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getGitStatusCached, GIT_CACHE_TTL_MS } from '../dist/git-cache.js';

const STATUS = { branch: 'main', isDirty: false, ahead: 0, behind: 0 };
const NOW = Date.UTC(2026, 6, 19, 12, 0, 0);

/** Fresh sandbox: fake home dir (for the HUD cache) + fake repo with .git. */
function makeSandbox({ gitFile = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-git-cache-'));
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(home, '.claude', 'plugins', 'claude-hud-enhanced'), { recursive: true });
  let gitDir = path.join(repo, '.git');
  if (gitFile) {
    // Worktree layout: .git is a FILE pointing at the real git dir elsewhere.
    gitDir = path.join(root, 'real-git-dir');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, '.git'), `gitdir: ${gitDir}\n`);
  } else {
    fs.mkdirSync(gitDir, { recursive: true });
  }
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(gitDir, 'index'), 'fake-index');
  return { root, home, repo, gitDir };
}

function makeFetcher(result = STATUS) {
  const fetcher = async () => {
    fetcher.calls++;
    return result;
  };
  fetcher.calls = 0;
  return fetcher;
}

test('miss → calls fetcher, writes cache; hit within TTL → no second fetch', async () => {
  const { home, repo } = makeSandbox();
  const fetcher = makeFetcher();
  const first = await getGitStatusCached(repo, { homeDir: home, now: () => NOW, fetch: fetcher });
  assert.deepEqual(first, STATUS);
  assert.equal(fetcher.calls, 1);

  const second = await getGitStatusCached(repo, { homeDir: home, now: () => NOW + 2000, fetch: fetcher });
  assert.deepEqual(second, STATUS);
  assert.equal(fetcher.calls, 1, 'served from cache, fetcher not called again');
});

test('TTL expiry → refetches', async () => {
  const { home, repo } = makeSandbox();
  const fetcher = makeFetcher();
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW, fetch: fetcher });
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW + GIT_CACHE_TTL_MS + 1, fetch: fetcher });
  assert.equal(fetcher.calls, 2);
});

test('HEAD mtime change invalidates instantly, within TTL', async () => {
  const { home, repo, gitDir } = makeSandbox();
  const fetcher = makeFetcher();
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW, fetch: fetcher });
  // Branch switch: HEAD rewritten → mtime moves.
  const future = new Date(NOW + 60_000);
  fs.utimesSync(path.join(gitDir, 'HEAD'), future, future);
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW + 1000, fetch: fetcher });
  assert.equal(fetcher.calls, 2, 'HEAD mtime change must bypass TTL');
});

test('index mtime change invalidates instantly, within TTL', async () => {
  const { home, repo, gitDir } = makeSandbox();
  const fetcher = makeFetcher();
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW, fetch: fetcher });
  const future = new Date(NOW + 60_000);
  fs.utimesSync(path.join(gitDir, 'index'), future, future);
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW + 1000, fetch: fetcher });
  assert.equal(fetcher.calls, 2, 'index mtime change must bypass TTL');
});

test('non-repo cwd → null without spawning the fetcher at all', async () => {
  const { home, root } = makeSandbox();
  const bare = path.join(root, 'not-a-repo');
  fs.mkdirSync(bare);
  const fetcher = makeFetcher();
  const result = await getGitStatusCached(bare, { homeDir: home, now: () => NOW, fetch: fetcher });
  assert.equal(result, null);
  assert.equal(fetcher.calls, 0);
});

test('worktree .git FILE (gitdir pointer) is resolved for mtime tracking', async () => {
  const { home, repo, gitDir } = makeSandbox({ gitFile: true });
  const fetcher = makeFetcher();
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW, fetch: fetcher });
  assert.equal(fetcher.calls, 1, 'worktree repo is treated as a repo');
  const future = new Date(NOW + 60_000);
  fs.utimesSync(path.join(gitDir, 'HEAD'), future, future);
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW + 1000, fetch: fetcher });
  assert.equal(fetcher.calls, 2, 'pointer-resolved HEAD mtime invalidates');
});

test('corrupt cache file → refetches gracefully', async () => {
  const { home, repo } = makeSandbox();
  const fetcher = makeFetcher();
  await getGitStatusCached(repo, { homeDir: home, now: () => NOW, fetch: fetcher });
  const cacheDir = path.join(home, '.claude', 'plugins', 'claude-hud-enhanced', 'git-cache');
  const [file] = fs.readdirSync(cacheDir);
  fs.writeFileSync(path.join(cacheDir, file), '{not json');
  const result = await getGitStatusCached(repo, { homeDir: home, now: () => NOW + 1000, fetch: fetcher });
  assert.deepEqual(result, STATUS);
  assert.equal(fetcher.calls, 2);
});

test('null fetch result is cached too (repo where git fails)', async () => {
  const { home, repo } = makeSandbox();
  const fetcher = makeFetcher(null);
  assert.equal(await getGitStatusCached(repo, { homeDir: home, now: () => NOW, fetch: fetcher }), null);
  assert.equal(await getGitStatusCached(repo, { homeDir: home, now: () => NOW + 1000, fetch: fetcher }), null);
  assert.equal(fetcher.calls, 1, 'negative result served from cache');
});
