import { type DaemonRequest } from './daemon-ipc.js';
/**
 * Warm daemon (phase 1, unix-only; docs/daemon-mode-design.md). Long-lived
 * per-profile process serving renders over a local socket so repaints cost a
 * socket round-trip instead of a runtime cold start. Requests are handled
 * SERIALIZED (see the design addendum): the requesting session's WHOLE
 * environment reaches render via process.env, and main() awaits between env
 * application and render — a queue removes the interleaving hazard for ~5-15ms
 * requests against 1-5s ticks.
 *
 * Staging the whole environment, rather than a named set, is what keeps the
 * daemon's own environment out of its answers. The daemon outlives every
 * session that talks to it, so anything it reads from its own env is the env of
 * whichever session started it first.
 */
export declare const DAEMON_IDLE_EXIT_MS: number;
/** Cap one render so a slow repo/subprocess can't stall other terminals'
 * queued requests. Comfortably above a warm render (~5-15ms) and above the
 * client's RESPONSE_TIMEOUT_MS (500ms) — the client always gives up first,
 * so by the time this fires the requester has already fallen back inline;
 * this timeout exists to unblock the QUEUE, not to answer the client. */
export declare const HANDLER_TIMEOUT_MS = 2000;
export interface DaemonOptions {
    socketPath?: string;
    idleTimeoutMs?: number;
    handlerTimeoutMs?: number;
    pluginVersion?: string;
    /** Injected in tests: turn one request into rendered output. */
    handleRequest?: (request: DaemonRequest) => Promise<string>;
    /** Injected in tests: process.exit replacement. */
    exit?: (code: number) => void;
}
/** Accept COLUMNS only as a sane numeric terminal width (validate at the trust
 * boundary, not just in downstream consumers). */
export declare function safeColumns(raw: string | undefined): string | undefined;
/**
 * Replaces process.env in place with the requesting session's snapshot.
 *
 * IN PLACE matters: `process.env = obj` drops Node's exotic env object, after
 * which writes no longer reach the real environment. So absent keys are deleted
 * and present keys assigned, leaving the same object identity.
 *
 * COLUMNS keeps its safeColumns() validation. It is the one value a render
 * consumes as a number, so it stays a checked trust boundary; an unusable width
 * is removed rather than passed through, and the render falls back to its
 * default. Every other variable is copied verbatim, because the daemon cannot
 * know which of them a future render will read.
 */
export declare function applyRequestEnv(requestEnv: Record<string, string> | undefined): void;
/** Restores a snapshot taken before applyRequestEnv, in place and exactly. */
export declare function restoreEnv(snapshot: NodeJS.ProcessEnv): void;
export declare function runDaemon(options?: DaemonOptions): void;
//# sourceMappingURL=daemon.d.ts.map