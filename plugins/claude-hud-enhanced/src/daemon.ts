import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDebug } from './debug.js';
import {
  type DaemonRequest,
  type DaemonResponse,
  IPC_PROTOCOL_VERSION,
  createLineDecoder,
  encodeMessage,
  getIpcPath,
  getPidPath,
  getPluginVersion,
} from './daemon-ipc.js';
import { main } from './index.js';
import { render } from './render/index.js';
import { ensurePrivateDir } from './utils/cache-file.js';

const debug = createDebug('daemon');

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
export const DAEMON_IDLE_EXIT_MS = 10 * 60_000;
/** Cap one render so a slow repo/subprocess can't stall other terminals'
 * queued requests. Comfortably above a warm render (~5-15ms) and above the
 * client's RESPONSE_TIMEOUT_MS (500ms) — the client always gives up first,
 * so by the time this fires the requester has already fallen back inline;
 * this timeout exists to unblock the QUEUE, not to answer the client. */
export const HANDLER_TIMEOUT_MS = 2_000;

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
export function safeColumns(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 2000 ? String(n) : undefined;
}

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
export function applyRequestEnv(requestEnv: Record<string, string> | undefined): void {
  const next = requestEnv ?? {};
  for (const key of Object.keys(process.env)) {
    if (!(key in next)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(next)) {
    if (typeof value !== 'string' || key === 'COLUMNS') continue;
    process.env[key] = value;
  }
  const columns = safeColumns(next.COLUMNS);
  if (columns != null) process.env.COLUMNS = columns;
  else delete process.env.COLUMNS;
}

/** Restores a snapshot taken before applyRequestEnv, in place and exactly. */
export function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === 'string') process.env[key] = value;
  }
}

/**
 * IMPORTANT: this function must NOT mutate any process-global state
 * (process.env etc.). When a request times out, its handler keeps running
 * ORPHANED past the queue's serialization — its return value is discarded,
 * but any global mutation (or deferred restore) would corrupt later requests.
 * All env staging lives in serveOne, strictly inside the serialized section.
 */
async function defaultHandleRequest(request: DaemonRequest): Promise<string> {
  const lines: string[] = [];
  await main({
    readStdin: async () => request.stdin,
    render: (ctx) => render(ctx, (line) => lines.push(line)),
    log: (...args: unknown[]) => lines.push(args.map(String).join(' ')),
    tryDaemonRender: null, // never recurse into ourselves
  });
  return lines.join('\n');
}

export function runDaemon(options: DaemonOptions = {}): void {
  if (process.platform === 'win32' && !options.socketPath) {
    // Phase 1 is unix-only; a named-pipe daemon that half-works would be
    // worse than the clean inline fallback Windows clients already take.
    debug('daemon mode is not supported on win32 yet (phase 2)');
    (options.exit ?? ((code: number) => process.exit(code)))(0);
    return;
  }
  const homeDir = os.homedir();
  const socketPath = options.socketPath ?? getIpcPath(homeDir);
  const idleTimeoutMs = options.idleTimeoutMs ?? DAEMON_IDLE_EXIT_MS;
  const handlerTimeoutMs = options.handlerTimeoutMs ?? HANDLER_TIMEOUT_MS;
  const pluginVersion = options.pluginVersion ?? getPluginVersion();
  const handleRequest = options.handleRequest ?? defaultHandleRequest;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const pidPath = options.socketPath ? null : getPidPath(homeDir); // advisory only

  let shuttingDown = false;
  let removeProcessListeners = (): void => {};
  const cleanup = (): void => {
    try {
      fs.rmSync(socketPath, { force: true });
    } catch {
      /* best effort */
    }
    if (pidPath) {
      try {
        fs.rmSync(pidPath, { force: true });
      } catch {
        /* best effort */
      }
    }
  };
  const shutdown = (code: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    debug('daemon exiting with code', code);
    removeProcessListeners();
    clearTimeout(idleTimer);
    try {
      server.close();
    } catch {
      /* best effort */
    }
    cleanup();
    exit(code);
  };

  let idleTimer: NodeJS.Timeout = setTimeout(() => shutdown(0), idleTimeoutMs);
  const touchIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => shutdown(0), idleTimeoutMs);
  };

  // Serialization queue (see module comment).
  let queue: Promise<void> = Promise.resolve();

  const serveOne = async (socket: net.Socket, message: unknown): Promise<void> => {
    touchIdle();
    const request = message as DaemonRequest | null;
    // Profile echo check (design §2): should be unreachable — socket paths are
    // derived from CLAUDE_CONFIG_DIR on both sides — but serving another
    // profile's request would mix accounts, so verify anyway.
    const sameProfile =
      request?.env?.CLAUDE_CONFIG_DIR === (process.env.CLAUDE_CONFIG_DIR ?? undefined);
    const valid =
      request != null &&
      request.v === IPC_PROTOCOL_VERSION &&
      request.stdin != null &&
      sameProfile;
    const mismatch = valid && request.pluginVersion !== pluginVersion;

    let output: string | null = null;
    if (valid) {
      // Env staging happens HERE, inside the serialized queue section — never
      // in the handler, whose orphaned continuation after a timeout must not
      // touch shared state (see defaultHandleRequest's contract). The orphan
      // may then render with a later request's env, but its output is
      // discarded, so that is harmless by construction.
      //
      // The WHOLE requesting environment is staged, not a named allowlist.
      // Every render-time `process.env` read then resolves to the REQUESTING
      // session's value, including reads added long after this code was
      // written. An allowlist has to be extended by hand for each new
      // variable, and one forgotten entry makes the daemon answer with another
      // session's environment. That is precisely how a Bedrock session's
      // CLAUDE_CODE_USE_BEDROCK=1 came to label every subscription session
      // "Bedrock" and hide its usage windows: getProviderLabel() reads that
      // variable, shouldHideUsage() treats Bedrock as API-billed, and the
      // daemon supplied its own env for both. ANTHROPIC_API_KEY (auth.ts) and
      // CLAUDE_HUD_DISABLE (index.ts) are the same shape.
      const prevEnv = { ...process.env };
      applyRequestEnv(request.env);
      let timeoutTimer: NodeJS.Timeout | undefined;
      try {
        // Per-request timeout: one slow render (e.g. git status on a flaky
        // network mount can take several seconds through git's own timeouts)
        // must not stall every OTHER terminal's queued request behind it.
        // On timeout we return null → that client falls back inline, and the
        // queue moves on. The orphaned handleRequest promise resolves later
        // and is discarded (Promise.race consumes its rejection, so it can
        // never surface as an unhandledRejection).
        output = await Promise.race([
          handleRequest(request),
          new Promise<null>((r) => {
            timeoutTimer = setTimeout(() => r(null), handlerTimeoutMs);
          }),
        ]);
      } catch (err) {
        debug('request handler failed:', err instanceof Error ? err.message : err);
        output = null; // client falls back inline
      } finally {
        clearTimeout(timeoutTimer); // don't leave a ~2s timer dangling per request
        restoreEnv(prevEnv);
      }
    }

    const response: DaemonResponse = {
      v: IPC_PROTOCOL_VERSION,
      pluginVersion,
      output,
      willExit: Boolean(mismatch),
    };
    try {
      socket.end(encodeMessage(response));
    } catch {
      /* client may already be gone (its own timeout) */
    }

    if (mismatch) {
      // Plugin was updated: this request was served correctly by old code;
      // exit so the next tick's client spawns the new version.
      debug('version mismatch (client', request?.pluginVersion, 'vs', pluginVersion, ') — exiting');
      shutdown(0);
    }
  };

  const server = net.createServer((socket) => {
    // A misbehaving same-user process could open sockets or send frames
    // without bound; cap both. maxConnections is generous for realistic
    // per-profile terminal counts, and a 1s per-socket idle timeout reaps
    // connections that connect but never send a complete request.
    socket.setTimeout(1_000, () => socket.destroy());
    socket.on('error', () => {
      /* per-connection errors never take the daemon down */
    });
    socket.on(
      'data',
      createLineDecoder((message) => {
        queue = queue.then(() => serveOne(socket, message)).catch(() => {});
      }),
    );
  });
  server.maxConnections = 16;

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Another daemon is (probably) alive on this socket — it wins; exit
      // quietly. If it was actually a stale socket, the next client's
      // connect failure unlinks it and respawns us.
      debug('socket in use — another daemon holds this profile');
      shuttingDown = true;
      removeProcessListeners();
      clearTimeout(idleTimer);
      exit(0); // deliberately NO socket/pid cleanup: they belong to the winner
      return;
    }
    debug('server error:', err.message);
    shutdown(1);
  });

  // Named handlers so shutdown can remove them — otherwise a second
  // runDaemon() in the same process (only the tests do this) leaves the
  // loser's handlers registered and a later signal fires every instance's
  // shutdown. In production the entry guard runs runDaemon exactly once.
  const onUncaught = (err: unknown): void => {
    debug('uncaughtException:', err instanceof Error ? err.message : err);
    shutdown(1);
  };
  const onRejection = (err: unknown): void => {
    debug('unhandledRejection:', err instanceof Error ? err.message : err);
    shutdown(1);
  };
  const onSigterm = (): void => shutdown(0);
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  process.on('SIGTERM', onSigterm);
  removeProcessListeners = (): void => {
    process.removeListener('uncaughtException', onUncaught);
    process.removeListener('unhandledRejection', onRejection);
    process.removeListener('SIGTERM', onSigterm);
  };

  if (process.platform !== 'win32') {
    // The 0700 socket dir is the trust boundary: the daemon fully trusts any
    // peer that can connect (it renders whatever stdin/cwd/transcript_path
    // the request names), so directory traversal permission — which both
    // Linux and macOS honor — is what must gate access. getIpcPath nests the
    // long-path/DrvFS fallback inside its own per-profile subdir, so this
    // holds for both the primary and fallback paths.
    try {
      ensurePrivateDir(path.dirname(socketPath));
    } catch (err) {
      // e.g. XDG_RUNTIME_DIR set but unwritable: exit loudly (debug) instead
      // of letting the entry guard's .catch swallow a silent crash — clients
      // keep rendering inline either way.
      debug('cannot create socket dir:', err instanceof Error ? err.message : err);
      shutdown(1);
      return;
    }
  }
  server.listen(socketPath, () => {
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      /* best effort */
    }
    if (pidPath) {
      try {
        fs.writeFileSync(pidPath, String(process.pid), { encoding: 'utf8', mode: 0o600 });
      } catch {
        /* advisory only */
      }
    }
    debug('daemon listening on', socketPath, 'version', pluginVersion);
  });
}
