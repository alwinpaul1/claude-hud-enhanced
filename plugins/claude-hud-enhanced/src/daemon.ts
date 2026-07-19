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
 * SERIALIZED (see the design addendum): terminal width reaches render via the
 * process-global COLUMNS env, and main() awaits between env application and
 * render — a queue removes the interleaving hazard for ~5-15ms requests
 * against 1-5s ticks.
 */
export const DAEMON_IDLE_EXIT_MS = 10 * 60_000;

export interface DaemonOptions {
  socketPath?: string;
  idleTimeoutMs?: number;
  pluginVersion?: string;
  /** Injected in tests: turn one request into rendered output. */
  handleRequest?: (request: DaemonRequest) => Promise<string>;
  /** Injected in tests: process.exit replacement. */
  exit?: (code: number) => void;
}

async function defaultHandleRequest(request: DaemonRequest): Promise<string> {
  const lines: string[] = [];
  const prevColumns = process.env.COLUMNS;
  if (request.env?.COLUMNS != null) {
    process.env.COLUMNS = request.env.COLUMNS;
  }
  try {
    await main({
      readStdin: async () => request.stdin,
      render: (ctx) => render(ctx, (line) => lines.push(line)),
      log: (...args: unknown[]) => lines.push(args.map(String).join(' ')),
      tryDaemonRender: null, // never recurse into ourselves
    });
  } finally {
    if (prevColumns === undefined) delete process.env.COLUMNS;
    else process.env.COLUMNS = prevColumns;
  }
  return lines.join('\n');
}

export function runDaemon(options: DaemonOptions = {}): void {
  const homeDir = os.homedir();
  const socketPath = options.socketPath ?? getIpcPath(homeDir);
  const idleTimeoutMs = options.idleTimeoutMs ?? DAEMON_IDLE_EXIT_MS;
  const pluginVersion = options.pluginVersion ?? getPluginVersion();
  const handleRequest = options.handleRequest ?? defaultHandleRequest;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const pidPath = options.socketPath ? null : getPidPath(homeDir); // advisory only

  let shuttingDown = false;
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
    const valid =
      request != null && request.v === IPC_PROTOCOL_VERSION && request.stdin != null;
    const mismatch = valid && request.pluginVersion !== pluginVersion;

    let output: string | null = null;
    if (valid) {
      try {
        output = await handleRequest(request);
      } catch (err) {
        debug('request handler failed:', err instanceof Error ? err.message : err);
        output = null; // client falls back inline
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

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Another daemon is (probably) alive on this socket — it wins; exit
      // quietly. If it was actually a stale socket, the next client's
      // connect failure unlinks it and respawns us.
      debug('socket in use — another daemon holds this profile');
      shuttingDown = true;
      clearTimeout(idleTimer);
      exit(0); // deliberately NO cleanup: the socket belongs to the winner
      return;
    }
    debug('server error:', err.message);
    shutdown(1);
  });

  process.on('uncaughtException', (err) => {
    debug('uncaughtException:', err instanceof Error ? err.message : err);
    shutdown(1);
  });
  process.on('unhandledRejection', (err) => {
    debug('unhandledRejection:', err instanceof Error ? err.message : err);
    shutdown(1);
  });
  process.on('SIGTERM', () => shutdown(0));

  if (process.platform !== 'win32') {
    const socketDir = path.dirname(socketPath);
    // Never chmod the shared OS temp dir (the long-path fallback lives
    // there); the socket file itself still gets 0600 after listen.
    if (socketDir !== os.tmpdir()) {
      ensurePrivateDir(socketDir);
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
