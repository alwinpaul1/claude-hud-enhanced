import type { GitStatus } from './git.js';
import type { AgentEntry } from './types.js';
export interface SubagentSeen {
    type: string;
    model: string;
    modelId: string;
    effort: string | null;
    tokens: number | null;
    window?: number;
    worktree?: string;
    git?: GitStatus | null;
}
export declare const MAX_PILL_AGENTS = 3;
export declare const subagentsDir: (transcriptPath: string) => string;
export interface AgentFeedEntry {
    modelId?: string;
    effort?: string;
    window?: number;
    tokens?: number;
}
export declare function parseAgentFeed(text: string): Record<string, AgentFeedEntry>;
export declare const knownWindows: Map<string, number>;
export declare const learnWindows: (text: string) => void;
export declare function seedKnownWindows(feedDir: string): void;
export declare function parseAgentTail(tail: string): {
    modelId: string | null;
    effort: string | null;
    tokens: number | null;
};
export declare function readRunningSubagents(transcriptPath: string | undefined, agents: AgentEntry[], getGit: (cwd: string) => Promise<GitStatus | null>, feedPath?: string): Promise<SubagentSeen[]>;
//# sourceMappingURL=subagents.d.ts.map