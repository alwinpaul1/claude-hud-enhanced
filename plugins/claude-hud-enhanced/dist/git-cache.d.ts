import { type GitStatus } from './git.js';
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
export declare const GIT_CACHE_TTL_MS = 5000;
export interface GitCacheDeps {
    homeDir?: string;
    now?: () => number;
    fetch?: (cwd: string) => Promise<GitStatus | null>;
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