import { type GitStatus } from './git.js';
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
export declare const GIT_CACHE_TTL_MS = 5000;
export declare const NULL_CACHE_TTL_MS = 1000;
export interface GitCacheDeps {
    homeDir?: string;
    now?: () => number;
    fetch?: (cwd: string) => Promise<GitStatus | null>;
    random?: () => number;
}
/**
 * Locate the actual git dir for a cwd without spawning git: walk up looking
 * for `.git`. A `.git` FILE is a worktree/submodule pointer (`gitdir: <path>`)
 * and is resolved so mtime checks track the real HEAD/index.
 */
export declare function findGitDir(cwd: string): string | null;
/** Drop-in cached variant of `getGitStatus` (same signature for MainDeps). */
export declare function getGitStatusCached(cwd?: string, deps?: GitCacheDeps): Promise<GitStatus | null>;
//# sourceMappingURL=git-cache.d.ts.map