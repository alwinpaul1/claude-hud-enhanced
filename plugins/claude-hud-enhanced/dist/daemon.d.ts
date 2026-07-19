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
export interface DaemonOptions {
    socketPath?: string;
    idleTimeoutMs?: number;
    pluginVersion?: string;
    /** Injected in tests: turn one request into rendered output. */
    handleRequest?: (request: DaemonRequest) => Promise<string>;
    /** Injected in tests: process.exit replacement. */
    exit?: (code: number) => void;
}
export declare function runDaemon(options?: DaemonOptions): void;
//# sourceMappingURL=daemon.d.ts.map