import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import { type GitStatus, getGitStatus } from './git.js';

const debug = createDebug('git-cache');

/**
 * Persistent git-status cache, ported from ccstatusline's shipped fix for its
 * per-refresh subprocess storm (their issues #22/#384). Without it the HUD
 * spawns up to ~7 `git` subprocesses on EVERY repaint — at a 1-2s
 * refreshInterval across several terminals that's thousands of spawns/hour.
 *
 * Validity: an entry serves for GIT_CACHE_TTL_MS, but is invalidated the
 * instant `.git/HEAD` or `.git/index` changes mtime (branch switch, commit,
 * staging) — the TTL only covers worktree-only edits that touch neither file,
 * so those can lag the display by at most the TTL.
 */
export const GIT_CACHE_TTL_MS = 5_000;

interface GitCacheEntry {
  version: 1;
  createdAt: number;
  headMtimeMs: number | null;
  indexMtimeMs: number | null;
  status: GitStatus | null;
}

export interface GitCacheDeps {
  homeDir?: string;
  now?: () => number;
  fetch?: (cwd: string) => Promise<GitStatus | null>;
}

function mtimeOrNull(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Locate the actual git dir for a cwd without spawning git: walk up looking
 * for `.git`. A `.git` FILE is a worktree/submodule pointer (`gitdir: <path>`)
 * and is resolved so mtime checks track the real HEAD/index.
 */
export function findGitDir(cwd: string): string | null {
  let dir = path.resolve(cwd);
  for (;;) {
    const candidate = path.join(dir, '.git');
    try {
      const st = fs.statSync(candidate);
      if (st.isDirectory()) return candidate;
      const pointer = fs.readFileSync(candidate, 'utf8').match(/^gitdir:\s*(.+)\s*$/m);
      if (pointer) {
        const target = path.resolve(dir, pointer[1].trim());
        return fs.existsSync(target) ? target : null;
      }
      return null;
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function cachePathFor(gitDir: string, homeDir: string): string {
  const key = createHash('sha256').update(gitDir).digest('hex').slice(0, 16);
  return path.join(getHudPluginDir(homeDir), 'git-cache', `git-${key}.json`);
}

function readEntry(cachePath: string): GitCacheEntry | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as GitCacheEntry;
    if (parsed?.version !== 1 || typeof parsed.createdAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEntry(cachePath: string, entry: GitCacheEntry): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600 });
  } catch (err) {
    debug('cache write failed:', err instanceof Error ? err.message : err);
  }
}

/** Drop-in cached variant of `getGitStatus` (same signature for MainDeps). */
export async function getGitStatusCached(
  cwd?: string,
  deps: GitCacheDeps = {},
): Promise<GitStatus | null> {
  if (!cwd) return null;
  const homeDir = deps.homeDir ?? os.homedir();
  const now = deps.now ?? Date.now;
  const fetch = deps.fetch ?? getGitStatus;

  const gitDir = findGitDir(cwd);
  if (!gitDir) return null; // not a repo: no cache AND no git spawns at all

  const headMtimeMs = mtimeOrNull(path.join(gitDir, 'HEAD'));
  const indexMtimeMs = mtimeOrNull(path.join(gitDir, 'index'));
  const cachePath = cachePathFor(gitDir, homeDir);

  const cached = readEntry(cachePath);
  if (
    cached &&
    now() - cached.createdAt < GIT_CACHE_TTL_MS &&
    cached.headMtimeMs === headMtimeMs &&
    cached.indexMtimeMs === indexMtimeMs
  ) {
    return cached.status;
  }

  const status = await fetch(cwd);
  writeEntry(cachePath, { version: 1, createdAt: now(), headMtimeMs, indexMtimeMs, status });
  return status;
}
