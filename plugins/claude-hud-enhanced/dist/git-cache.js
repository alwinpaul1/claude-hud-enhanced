import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
import { getGitStatus } from './git.js';
import { CACHE_SWEEP_SAMPLE_RATE, readJsonCache, sweepCacheDir, writeJsonCacheAtomic, } from './utils/cache-file.js';
const debug = createDebug('git-cache');
/**
 * Persistent git-status cache, ported from ccstatusline's shipped fix for its
 * per-refresh subprocess storm (their issues #22/#384). Without it the HUD
 * spawns up to ~7 `git` subprocesses on EVERY repaint — at a 1-2s
 * refreshInterval across several terminals that's thousands of spawns/hour.
 *
 * Staleness model: an entry serves for GIT_CACHE_TTL_MS, and is additionally
 * invalidated the instant `.git/HEAD` or `.git/index` changes mtime (branch
 * switch, commit, staging). Everything that touches neither file rides the
 * TTL — and that includes the MOST COMMON event while a statusline is live
 * (editing a tracked file, which only changes the worktree) as well as
 * ref-only moves like `git reset --soft`. So dirty-state, line diffs, and
 * ahead/behind can lag the truth by up to GIT_CACHE_TTL_MS; that is the
 * deliberate trade for killing the spawn storm.
 *
 * Failed lookups (`status: null` — e.g. a freshly `git init`ed repo with no
 * commits, git missing from PATH, transient lock contention) are cached for
 * only NULL_CACHE_TTL_MS: long enough to throttle the persistent-failure
 * cases to ~1 spawn/sec, short enough that a transient hiccup never blanks
 * the git segment for more than a second.
 */
export const GIT_CACHE_TTL_MS = 5_000;
export const NULL_CACHE_TTL_MS = 1_000;
function mtimeOrNull(p) {
    try {
        return fs.statSync(p).mtimeMs;
    }
    catch {
        return null;
    }
}
/**
 * Locate the actual git dir for a cwd without spawning git: walk up looking
 * for `.git`. A `.git` FILE is a worktree/submodule pointer (`gitdir: <path>`)
 * and is resolved so mtime checks track the real HEAD/index.
 */
export function findGitDir(cwd) {
    let dir = path.resolve(cwd);
    for (;;) {
        const candidate = path.join(dir, '.git');
        try {
            const st = fs.statSync(candidate);
            if (st.isDirectory())
                return candidate;
            const pointer = fs.readFileSync(candidate, 'utf8').match(/^gitdir:\s*(.+)\s*$/m);
            if (pointer) {
                const target = path.resolve(dir, pointer[1].trim());
                return fs.existsSync(target) ? target : null;
            }
            return null;
        }
        catch {
            /* keep walking up */
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
}
function cacheDirFor(homeDir) {
    return path.join(getHudPluginDir(homeDir), 'git-cache');
}
function cachePathFor(gitDir, homeDir) {
    const key = createHash('sha256').update(gitDir).digest('hex').slice(0, 16);
    return path.join(cacheDirFor(homeDir), `git-${key}.json`);
}
function isGitCacheEntry(v) {
    const e = v;
    return e != null && e.version === 1 && typeof e.createdAt === 'number';
}
function readEntry(cachePath) {
    return readJsonCache(cachePath, isGitCacheEntry, (err) => debug('cache read failed:', err instanceof Error ? err.message : err));
}
function writeEntry(cachePath, entry) {
    writeJsonCacheAtomic(cachePath, entry, (err) => debug('cache write failed:', err instanceof Error ? err.message : err));
}
/** Drop-in cached variant of `getGitStatus` (same signature for MainDeps). */
export async function getGitStatusCached(cwd, deps = {}) {
    if (!cwd)
        return null;
    const homeDir = deps.homeDir ?? os.homedir();
    const now = deps.now ?? Date.now;
    const fetch = deps.fetch ?? getGitStatus;
    const random = deps.random ?? Math.random;
    const gitDir = findGitDir(cwd);
    if (!gitDir)
        return null; // not a repo: no cache AND no git spawns at all
    const headMtimeMs = mtimeOrNull(path.join(gitDir, 'HEAD'));
    const indexMtimeMs = mtimeOrNull(path.join(gitDir, 'index'));
    const cachePath = cachePathFor(gitDir, homeDir);
    const cached = readEntry(cachePath);
    if (cached &&
        now() - cached.createdAt <
            (cached.status === null ? NULL_CACHE_TTL_MS : GIT_CACHE_TTL_MS) &&
        cached.headMtimeMs === headMtimeMs &&
        cached.indexMtimeMs === indexMtimeMs) {
        return cached.status;
    }
    const status = await fetch(cwd);
    writeEntry(cachePath, { version: 1, createdAt: now(), headMtimeMs, indexMtimeMs, status });
    if (random() < CACHE_SWEEP_SAMPLE_RATE) {
        sweepCacheDir(cacheDirFor(homeDir), now(), (err) => debug('cache sweep failed:', err instanceof Error ? err.message : err));
    }
    return status;
}
//# sourceMappingURL=git-cache.js.map