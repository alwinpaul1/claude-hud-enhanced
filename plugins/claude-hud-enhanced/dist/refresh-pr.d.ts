import { type Pr, type PrRequest, type PrSnapshot } from './pr-status.js';
export interface RunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export type Run = (argv: string[], opts: {
    cwd: string;
    timeoutMs?: number;
    env?: Record<string, string>;
}) => Promise<RunResult>;
export interface PrRefreshState {
    version: 1;
    prView: Record<string, {
        at: number;
        pr: Pr | null;
    }>;
    gh: Record<string, {
        etag: string;
        body: string;
    }>;
    fetchedAt: Record<string, number>;
    remotes: Record<string, string>;
}
export interface RefreshDeps {
    run: Run;
    now: () => number;
}
export declare const emptyState: () => PrRefreshState;
export declare function refreshPr(req: PrRequest, state: PrRefreshState, deps: RefreshDeps): Promise<{
    snapshot: PrSnapshot;
    fetch: (() => Promise<void>) | null;
}>;
//# sourceMappingURL=refresh-pr.d.ts.map