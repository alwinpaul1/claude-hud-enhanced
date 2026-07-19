import { type DaemonRequest } from './daemon-ipc.js';
/**
 * Warm daemon (phase 1, unix-only; docs/daemon-mode-design.md). Long-lived
 * per-profile process serving renders over a local socket so repaints cost a
 * socket round-trip instead of a runtime cold start. Requests are handled
 * SERIALIZED (see the design addendum): terminal width reaches render via the
 * process-global COLUMNS env, and main() awaits between env application and
 * render — a queue removes the interleaving hazard for ~5-15ms requests
 * against 1-5s ticks.
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
export declare function runDaemon(options?: DaemonOptions): void;
//# sourceMappingURL=daemon.d.ts.map