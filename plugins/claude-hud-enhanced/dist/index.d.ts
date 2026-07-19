import { readStdin, getUsageFromStdin } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import type { getGitStatus } from "./git.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getClaudeCodeVersion } from "./version.js";
import { getMemoryUsage } from "./memory.js";
import { readAuthInfo } from "./auth.js";
import { applyContextWindowFallback } from "./context-cache.js";
import { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import type { StdinData } from "./types.js";
export { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
export type MainDeps = {
    readStdin: typeof readStdin;
    getUsageFromStdin: typeof getUsageFromStdin;
    getUsageFromExternalSnapshot: typeof getUsageFromExternalSnapshot;
    writeExternalUsageSnapshot: typeof writeExternalUsageSnapshot;
    parseTranscript: typeof parseTranscript;
    countConfigs: typeof countConfigs;
    getGitStatus: typeof getGitStatus;
    loadConfig: typeof loadConfig;
    parseExtraCmdArg: typeof parseExtraCmdArg;
    runExtraCmd: typeof runExtraCmd;
    getClaudeCodeVersion: typeof getClaudeCodeVersion;
    getMemoryUsage: typeof getMemoryUsage;
    readAuthInfo: typeof readAuthInfo;
    applyContextWindowFallback: typeof applyContextWindowFallback;
    render: typeof render;
    now: () => number;
    log: (...args: unknown[]) => void;
    /**
     * Warm-daemon client (null inside the daemon itself so it never recurses).
     * Returns the full rendered output, or null on any failure — the caller
     * then falls through to the unmodified inline path.
     */
    tryDaemonRender: ((stdin: StdinData, entryPath: string) => Promise<string | null>) | null;
};
export declare function isHudDisabled(env?: NodeJS.ProcessEnv): boolean;
export declare function main(overrides?: Partial<MainDeps>): Promise<void>;
export declare function formatSessionDuration(sessionStart?: Date, now?: () => number): string;
//# sourceMappingURL=index.d.ts.map