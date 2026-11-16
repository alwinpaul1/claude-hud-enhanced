import { type SnapshotFsDeps } from './usage-snapshot.js';
export type Readiness = 'clean' | 'conflicts' | 'blocked' | 'failing' | 'behind' | 'unknown';
export interface Checks {
    failing: number;
    pending: number;
    passing: number;
}
export interface Pr {
    number: number;
    state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED';
    branch?: string;
    base?: string;
    ready?: Readiness;
    checks?: Checks;
}
export interface SessionPrRef {
    number: number;
    url: string;
    owned: boolean;
}
export interface BaseCompare {
    name: string;
    behind: number;
    ahead: number;
}
export interface PrRequest {
    cwd: string;
    session: string;
    branch: string;
    named: number | null;
    sessionPr: SessionPrRef | null;
}
export interface PrSnapshot {
    version: 1;
    at: number;
    request: string;
    pr: Pr | null;
    own?: {
        branch: string;
        ahead: number;
        behind: number;
    };
    base?: BaseCompare;
}
export interface PrPaths {
    snapshot: string;
    state: string;
    lock: string;
}
export declare const PR_LIVE_EVERY = 5000;
export declare const PR_IDLE_EVERY = 60000;
export declare const PR_EVERY: number;
export declare const FETCH_EVERY: number;
export declare const parseTrack: (out: string) => {
    ahead: number;
    behind: number;
};
export declare const prFromTitle: (t: string | null | undefined) => number | null;
export declare const parsePr: (json: string) => Pr | null;
export declare const isGhPrCommand: (command: string) => boolean;
export declare const prFromCommand: (command: string, output: string) => SessionPrRef | null;
export declare const prFromResult: (result: unknown) => SessionPrRef | null;
export declare const pickPr: (prev: SessionPrRef | null, seen: SessionPrRef | null) => SessionPrRef | null;
export declare const splitHttp: (out: string) => {
    status: number;
    etag: string | null;
    body: string;
};
export declare const parsePull: (body: string) => (Pr & {
    sha: string;
}) | null;
export declare const parseChecks: (body: string) => Checks | null;
export declare const parseRemote: (url: string) => string;
export declare const repoOf: (url: string | undefined) => string;
export declare const parseLeftRight: (out: string) => {
    behind: number;
    ahead: number;
} | null;
export declare const requestKey: (req: PrRequest) => string;
export declare function prPaths(req: Pick<PrRequest, 'cwd' | 'session'>, homeDir?: string): PrPaths;
export declare function isPrSnapshot(v: unknown): v is PrSnapshot;
export interface ResolvePrDeps {
    now: () => number;
    homeDir?: string;
    fs?: SnapshotFsDeps;
    ensureDir: (dir: string) => void;
    spawnRefresher: (req: PrRequest, paths: PrPaths) => void;
}
export declare function resolvePrStatus(req: PrRequest, deps: ResolvePrDeps): PrSnapshot | null;
//# sourceMappingURL=pr-status.d.ts.map