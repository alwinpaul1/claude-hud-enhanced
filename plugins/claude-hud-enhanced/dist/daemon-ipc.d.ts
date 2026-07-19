import type { StdinData } from './types.js';
/**
 * Shared IPC pieces for warm daemon mode (docs/daemon-mode-design.md):
 * per-profile socket/pipe path, newline-delimited-JSON framing, and the
 * plugin's own version (for the client↔daemon handshake).
 */
export declare const IPC_PROTOCOL_VERSION = 1;
/** Reject absurd frames instead of buffering without bound. */
export declare const MAX_FRAME_BYTES: number;
export interface DaemonRequest {
    v: number;
    pluginVersion: string;
    stdin: StdinData;
    cwd: string;
    env: {
        COLUMNS?: string;
        CLAUDE_CONFIG_DIR?: string;
    };
    now: number;
}
export interface DaemonResponse {
    v: number;
    pluginVersion: string;
    output: string | null;
    willExit: boolean;
}
export declare function getIpcDir(homeDir?: string): string;
export declare function getIpcPath(homeDir?: string): string;
export declare function getSpawnLockPath(homeDir?: string): string;
export declare function getPidPath(homeDir?: string): string;
/**
 * This PLUGIN's version (package.json one level above src/ and dist/ alike) —
 * distinct from version.ts, which resolves the `claude` CLI's version.
 */
export declare function getPluginVersion(): string;
/**
 * Newline-delimited JSON framing. JSON.stringify escapes literal newlines
 * inside string values, so a serialized message can never contain a raw
 * newline byte — splitting the stream on '\n' is unambiguous.
 */
export declare function encodeMessage(message: unknown): string;
/**
 * Incremental decoder: feed socket chunks in, complete messages come out.
 * Malformed JSON frames are surfaced as null so callers can fail the request
 * instead of hanging. Oversized buffers reset (a peer that sends >1MB without
 * a newline is broken by definition).
 */
export declare function createLineDecoder(onMessage: (message: unknown | null) => void): (chunk: Buffer | string) => void;
//# sourceMappingURL=daemon-ipc.d.ts.map