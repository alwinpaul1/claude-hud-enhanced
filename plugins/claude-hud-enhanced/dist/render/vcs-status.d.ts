import type { HudConfig, GitBranchOverflowMode } from '../config.js';
import type { GitStatus, FileStats, LineDiff } from '../git.js';
import type { HudColorOverrides } from '../config.js';
import type { Pr, PrSnapshot } from '../pr-status.js';
export interface VcsDisplayState {
    kind: 'git' | 'jj';
    branch: string;
    dirty: boolean;
    conflict: boolean;
    ahead: number;
    behind: number;
    fileStats?: FileStats;
    lineDiff?: LineDiff;
    branchUrl?: string;
    branchOverflow: GitBranchOverflowMode;
    linked: boolean;
}
/**
 * Resolve VCS-specific visibility once so compact and expanded layouts cannot
 * drift. jj never inherits Git-only ahead/behind or file-stat settings.
 */
export declare function getVcsDisplayState(status: GitStatus | null, config: Pick<Partial<HudConfig>, 'gitStatus' | 'jjStatus'>): VcsDisplayState | null;
export type GitDetail = 'full' | 'brief' | 'clipped' | 'none';
export declare const MIN_BRANCH_CELLS = 8;
export declare const vcsLabel: (vcs: VcsDisplayState) => string;
export declare const clipBranch: (branch: string, cells: number) => string;
type Colors = Partial<HudColorOverrides> | undefined;
export declare function currentPr(snapshot: PrSnapshot | null | undefined): Pr | null;
export declare function formatPrBadge(pr: Pr, colors: Colors, detail?: GitDetail): string;
export {};
//# sourceMappingURL=vcs-status.d.ts.map