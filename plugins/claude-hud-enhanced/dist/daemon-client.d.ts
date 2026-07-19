import type { StdinData } from './types.js';
export declare const CONNECT_TIMEOUT_MS = 50;
export declare const RESPONSE_TIMEOUT_MS = 500;
export interface DaemonClientDeps {
    homeDir?: string;
    connectTimeoutMs?: number;
    responseTimeoutMs?: number;
    /** Injected for tests; default spawns the real detached daemon. */
    spawnDaemon?: (entryPath: string, homeDir: string) => void;
    now?: () => number;
}
/**
 * Try to render via the warm per-profile daemon. Returns the full output
 * string on success, or null on ANY failure — the caller falls through to
 * the unmodified inline path, so this can only ever make a repaint faster,
 * never break it. On "nothing is listening" failures the stale socket is
 * removed and a fresh daemon is spawned for the next tick; on "alive but
 * slow" failures the socket is left alone (a live daemon must not have its
 * socket unlinked from under it).
 */
export declare function tryDaemonRender(stdin: StdinData, entryPath: string, deps?: DaemonClientDeps): Promise<string | null>;
//# sourceMappingURL=daemon-client.d.ts.map