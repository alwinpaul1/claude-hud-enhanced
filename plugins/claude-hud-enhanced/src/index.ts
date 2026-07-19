import { readStdin, getUsageFromStdin } from "./stdin.js";
import { applyIdleUsageReset } from "./idle-usage-reset.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import type { getGitStatus } from "./git.js";
import { getGitStatusCached } from "./git-cache.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getClaudeCodeVersion } from "./version.js";
import { getMemoryUsage } from "./memory.js";
import { readAuthInfo } from "./auth.js";
import { resolveEffortLevel } from "./effort.js";
import { applyContextWindowFallback } from "./context-cache.js";
import { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import { resolveUsage, defaultSnapshotFs } from "./usage-hybrid.js";
import { getLockPath } from "./usage-snapshot.js";
import { setLanguage, t } from "./i18n/index.js";
import { tryDaemonRender } from "./daemon-client.js";
import type { RenderContext, StdinData } from "./types.js";

export { getUsageFromExternalSnapshot, writeExternalUsageSnapshot } from "./external-usage.js";
import { fileURLToPath } from "node:url";
import { realpathSync, existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import * as os from "node:os";
import * as nodePath from "node:path";

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

/**
 * Returns true when the HUD is disabled for this invocation via the
 * CLAUDE_HUD_DISABLE environment variable. Any non-blank value other than an
 * explicit negative (`0`, `false`, `off`, `no`, case-insensitive) disables the
 * HUD, so users can launch sessions without it (`CLAUDE_HUD_DISABLE=1 claude`)
 * while keeping the statusLine entry in settings.json intact.
 */
/**
 * Fire-and-forget launch of the detached OAuth usage refresher. The refresher
 * (dist/refresh-usage.js) is NOT part of this repo's build — see
 * docs/oauth-usage-poll-handoff.md; if it is absent this is a silent no-op, so
 * the oauthUsagePoll flag degrades gracefully to plain stdin behavior.
 */
function refresherScriptPath(): string {
  return nodePath.join(
    nodePath.dirname(fileURLToPath(import.meta.url)),
    "refresh-usage.js",
  );
}

function spawnUsageRefresher(_homeDir: string): void {
  try {
    const script = refresherScriptPath();
    if (!existsSync(script)) return; // hand-off file not installed yet
    const child = spawn(process.execPath, [script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env, // inherit CLAUDE_CONFIG_DIR so the profile matches
    });
    child.on("error", () => {
      // The parent took the single-flight lock before spawning; if the child
      // never starts, its `finally` can never release it. Release here so a
      // persistent spawn failure (EMFILE etc.) doesn't silently block every
      // refresh for LOCK_STALE_MS per attempt.
      try {
        rmSync(getLockPath(os.homedir()), { force: true });
      } catch {
        /* stale-lock reclaim will recover */
      }
    });
    child.unref();
  } catch {
    /* never break the HUD over a failed spawn */
  }
}

export function isHudDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CLAUDE_HUD_DISABLE?.trim().toLowerCase();
  if (value === undefined || value === "") {
    return false;
  }
  return value !== "0" && value !== "false" && value !== "off" && value !== "no";
}

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
  if (isHudDisabled()) {
    // Print nothing so Claude Code renders an empty statusline, and skip all
    // work (stdin parse, transcript scan, git) — this runs on every repaint
    // (conversation events debounced at 300ms, plus the refreshInterval timer
    // while idle), so even the disabled path must stay cheap.
    return;
  }

  const deps: MainDeps = {
    readStdin,
    getUsageFromStdin,
    getUsageFromExternalSnapshot,
    writeExternalUsageSnapshot,
    parseTranscript,
    countConfigs,
    // TTL+mtime cached: avoids ~7 git spawns per repaint (critical at 1-2s
    // refreshInterval across many terminals; see git-cache.ts).
    getGitStatus: getGitStatusCached,
    loadConfig,
    parseExtraCmdArg,
    runExtraCmd,
    getClaudeCodeVersion,
    getMemoryUsage,
    readAuthInfo,
    applyContextWindowFallback,
    render,
    now: () => Date.now(),
    log: console.log,
    tryDaemonRender,
    ...overrides,
  };

  try {
    const stdin = await deps.readStdin();

    if (!stdin) {
      // Running without stdin - this happens during setup verification
      const config = await deps.loadConfig();
      setLanguage(config.language);
      const isMacOS = process.platform === "darwin";
      deps.log(t("init.initializing"));
      if (isMacOS) {
        deps.log(t("init.macosNote"));
      }
      return;
    }

    // Config loads first: the daemon-or-not decision needs it (a mechanical
    // reordering of 0.4.13's parallelization — transcript + counts stay
    // concurrent below; config was never a dependency of either).
    const config = await deps.loadConfig();
    setLanguage(config.language);

    // Warm daemon (opt-in): hand the parsed stdin to the per-profile daemon
    // and print its render, skipping all per-process work below. ANY failure
    // returns null and falls through to the unmodified inline path — the
    // daemon can make a repaint faster, never break it.
    if (config.daemon.enabled && deps.tryDaemonRender) {
      const output = await deps.tryDaemonRender(stdin, scriptPath);
      if (output !== null) {
        deps.log(output);
        return;
      }
    }

    const transcriptPath = stdin.transcript_path ?? "";
    // Transcript parse and config counts are independent I/O — run them
    // concurrently. Git status stays sequential after config: its
    // enabled-gate is config data, and running git work for users who
    // disabled it would violate their intent.
    const [transcript, configCounts] = await Promise.all([
      deps.parseTranscript(transcriptPath),
      deps.countConfigs(stdin.cwd),
    ]);

    deps.applyContextWindowFallback(stdin, {}, transcript.sessionName, {
      lastCompactBoundaryAt: transcript.lastCompactBoundaryAt,
      lastCompactPostTokens: transcript.lastCompactPostTokens,
    });

    const { claudeMdCount, rulesCount, mcpCount, hooksCount, outputStyle } =
      configCounts;
    const gitStatus = config.gitStatus.enabled
      ? await deps.getGitStatus(stdin.cwd)
      : null;

    let usageData: RenderContext["usageData"] = null;
    const shouldReadUsage = config.display.showUsage !== false;
    const shouldWriteUsage = Boolean(config.display.externalUsageWritePath);
    const stdinUsage = shouldReadUsage || shouldWriteUsage
      ? deps.getUsageFromStdin(stdin)
      : null;

    if (shouldWriteUsage && stdinUsage) {
      deps.writeExternalUsageSnapshot(config, stdinUsage, deps.now());
    }

    if (shouldReadUsage) {
      usageData = stdinUsage;
      if (!usageData) {
        usageData = deps.getUsageFromExternalSnapshot(config, deps.now());
      } else if (config.display.externalUsagePath) {
        const ext = deps.getUsageFromExternalSnapshot(config, deps.now());
        if (ext != null) {
          usageData = {
            ...usageData,
            ...(ext.balanceLabel != null && { balanceLabel: ext.balanceLabel }),
            // If stdin did not provide sevenDay (e.g. third-party clients like the
            // Claudian Obsidian plugin that only surface five_hour), fall back to the
            // external snapshot so the weekly limit still shows in the HUD.
            ...(usageData.sevenDay == null && ext.sevenDay != null && {
              sevenDay: ext.sevenDay,
              sevenDayResetAt: ext.sevenDayResetAt ?? null,
            }),
          };
        }
      }

      // Hybrid OAuth poll (opt-in): stdin while active; when stdin stops
      // advancing (idle), serve/refresh the shared snapshot via a detached
      // background refresher so account-wide usage stays current.
      if (config.display.oauthUsagePoll) {
        usageData = resolveUsage(usageData, true, {
          now: deps.now,
          homeDir: os.homedir(),
          fs: defaultSnapshotFs,
          spawnRefresher: spawnUsageRefresher,
          // Skip lock churn entirely while the owner-supplied refresher script
          // is absent (see docs/oauth-usage-poll-handoff.md).
          canRefresh: () => existsSync(refresherScriptPath()),
        });
      }

      // Local idle reset detection (no network): reflect a window that rolled
      // over while idle (reset time passed) as ~0% instead of a stale value.
      if (config.display.idleUsageReset) {
        usageData = applyIdleUsageReset(usageData, deps.now());
      }
    }

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;

    const sessionDuration = formatSessionDuration(
      transcript.sessionStart,
      deps.now,
    );
    const claudeCodeVersion = config.display.showClaudeCodeVersion
      ? await deps.getClaudeCodeVersion()
      : undefined;
    const effortInfo = config.display.showEffortLevel
      ? resolveEffortLevel(stdin.effort, { ultracodeActive: transcript.ultracodeActive })
      : null;
    const memoryUsage =
      config.display.showMemoryUsage && config.lineLayout === "expanded"
        ? await deps.getMemoryUsage()
        : null;
    const authInfo =
      config.display.showAuth || config.display.showAuthUser
        ? deps.readAuthInfo()
        : null;

    const ctx: RenderContext = {
      stdin,
      transcript,
      claudeMdCount,
      rulesCount,
      mcpCount,
      hooksCount,
      sessionDuration,
      gitStatus,
      usageData,
      memoryUsage,
      config,
      extraLabel,
      outputStyle,
      claudeCodeVersion,
      effortLevel: effortInfo?.level,
      effortSymbol: effortInfo?.symbol,
      authInfo,
    };

    deps.render(ctx);
  } catch (error) {
    deps.log(
      "[claude-hud-enhanced] Error:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

export function formatSessionDuration(
  sessionStart?: Date,
  now: () => number = () => Date.now(),
): string {
  if (!sessionStart) {
    return "";
  }

  const ms = now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

const scriptPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];
const isSamePath = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};
if (argvPath && isSamePath(argvPath, scriptPath)) {
  if (process.argv.includes("--daemon")) {
    // Warm daemon mode (spawned by daemon-client, never user-invoked).
    // Dynamic import keeps the normal render path from loading `net`.
    void import("./daemon.js")
      .then((m) => m.runDaemon())
      .catch(() => process.exit(1));
  } else {
    void main();
  }
}
