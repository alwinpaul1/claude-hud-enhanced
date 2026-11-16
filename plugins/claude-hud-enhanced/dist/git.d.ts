export interface LineDiff {
    added: number;
    deleted: number;
}
export interface TrackedFile {
    basename: string;
    fullPath: string;
    type: 'modified' | 'added' | 'deleted';
    lineDiff?: LineDiff;
}
export interface FileStats {
    modified: number;
    added: number;
    deleted: number;
    untracked: number;
    staged?: number;
    unstaged?: number;
    conflicts?: number;
    trackedFiles: TrackedFile[];
}
export interface GitStatus {
    branch: string;
    isDirty: boolean;
    ahead: number;
    behind: number;
    fileStats?: FileStats;
    lineDiff?: LineDiff;
    branchUrl?: string;
    /** Which VCS produced this status. Omitted (undefined) means 'git'. */
    vcs?: 'git' | 'jj';
    /** jj-native: true when the working-copy commit has an unresolved conflict. */
    conflict?: boolean;
    worktree?: string;
    isLinked?: boolean;
}
export declare function getGitBranch(cwd?: string): Promise<string | null>;
export declare function getGitStatus(cwd?: string): Promise<GitStatus | null>;
//# sourceMappingURL=git.d.ts.map