import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getGitBranch } from '../dist/git.js';

test('getGitBranch returns null when cwd is undefined', async () => {
  const result = await getGitBranch(undefined);
  assert.equal(result, null);
});

test('getGitBranch returns null for non-git directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-nogit-'));
  try {
    const result = await getGitBranch(dir);
    assert.equal(result, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitBranch returns branch name for git directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitBranch(dir);
    assert.ok(result === 'main' || result === 'master', `Expected main or master, got ${result}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('getGitBranch returns custom branch name', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-git-'));
  try {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['checkout', '-b', 'feature/test-branch'], { cwd: dir, stdio: 'ignore' });

    const result = await getGitBranch(dir);
    assert.equal(result, 'feature/test-branch');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
