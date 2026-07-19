import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import { createDebug } from './debug.js';
import {
  type DaemonRequest,
  type DaemonResponse,
  IPC_PROTOCOL_VERSION,
  createLineDecoder,
  encodeMessage,
  getIpcDir,
  getIpcPath,
  getPluginVersion,
  getSpawnLockPath,
} from './daemon-ipc.js';
import type { StdinData } from './types.js';
import { tryTakeLock } from './usage-hybrid.js';
import { defaultSnapshotFs } from './usage-snapshot.js';
import { ensurePrivateDir } from './utils/cache-file.js';

const debug = createDebug('daemon-client');

export const CONNECT_TIMEOUT_MS = 50;
export const RESPONSE_TIMEOUT_MS = 500;

type RequestOutcome =
  | { kind: 'ok'; output: string }
  | { kind: 'conn-error' } // no daemon there (ENOENT/ECONNREFUSED/connect timeout)
  | { kind: 'failed' }; // daemon alive but slow/broken — do NOT unlink its socket

export interface DaemonClientDeps {
  homeDir?: string;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  /** Injected for tests; default spawns the real detached daemon. */
  spawnDaemon?: (entryPath: string, homeDir: string) => void;
  now?: () => number;
}

function requestOnce(
  socketPath: string,
  request: DaemonRequest,
  connectTimeoutMs: number,
  responseTimeoutMs: number,
): Promise<RequestOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: RequestOutcome, socket?: net.Socket): void => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(outcome);
    };

    let socket: net.Socket;
    try {
      socket = net.connect(socketPath);
    } catch {
      resolve({ kind: 'conn-error' });
      return;
    }

    const connectTimer = setTimeout(() => finish({ kind: 'conn-error' }, socket), connectTimeoutMs);
    const overallTimer = setTimeout(() => finish({ kind: 'failed' }, socket), responseTimeoutMs);

    socket.on('error', () => {
      clearTimeout(connectTimer);
      clearTimeout(overallTimer);
      finish({ kind: 'conn-error' }, socket);
    });

    socket.on('connect', () => {
      clearTimeout(connectTimer);
      socket.write(encodeMessage(request));
    });

    socket.on(
      'data',
      createLineDecoder((message) => {
        clearTimeout(overallTimer);
        const res = message as DaemonResponse | null;
        if (
          res != null &&
          res.v === IPC_PROTOCOL_VERSION &&
          typeof res.output === 'string'
        ) {
          finish({ kind: 'ok', output: res.output }, socket);
        } else {
          finish({ kind: 'failed' }, socket);
        }
      }),
    );

    socket.on('close', () => {
      clearTimeout(connectTimer);
      clearTimeout(overallTimer);
      finish({ kind: 'failed' }, socket);
    });
  });
}

function defaultSpawnDaemon(entryPath: string, _homeDir: string): void {
  try {
    const child = spawn(
      process.execPath,
      [...process.execArgv, entryPath, '--daemon'],
      { detached: true, stdio: 'ignore', windowsHide: true, env: process.env },
    );
    child.on('error', () => {
      /* daemon spawn is best-effort; inline mode already served this tick */
    });
    child.unref();
  } catch {
    /* best effort */
  }
}

/**
 * Fire-and-forget daemon (re)spawn behind the dedicated spawn lock — held
 * only for the duration of the spawn call itself, and taken with the same
 * atomic rename-steal discipline as the usage refresher lock so N racing
 * clients can't start N daemons. Losers simply render inline this tick.
 */
function spawnDaemonOnce(entryPath: string, homeDir: string, deps: DaemonClientDeps): void {
  const lockPath = getSpawnLockPath(homeDir);
  const now = (deps.now ?? Date.now)();
  try {
    ensurePrivateDir(getIpcDir(homeDir));
    if (!tryTakeLock(lockPath, now, defaultSnapshotFs)) return;
    // The lock is deliberately NOT released after spawning: racers arrive
    // sequentially (separate processes, non-overlapping critical sections),
    // so an immediate release would let every one of them spawn. Leaving the
    // lock caps spawn attempts at one per LOCK_STALE_MS (60s) per profile —
    // if the spawned daemon dies instantly, the next attempt waits out the
    // staleness window, and clients render inline meanwhile.
    (deps.spawnDaemon ?? defaultSpawnDaemon)(entryPath, homeDir);
  } catch {
    /* best effort — inline mode already served this tick */
  }
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
export async function tryDaemonRender(
  stdin: StdinData,
  entryPath: string,
  deps: DaemonClientDeps = {},
): Promise<string | null> {
  if (process.platform === 'win32') return null; // phase 2
  const homeDir = deps.homeDir ?? os.homedir();
  const socketPath = getIpcPath(homeDir);

  const request: DaemonRequest = {
    v: IPC_PROTOCOL_VERSION,
    pluginVersion: getPluginVersion(),
    stdin,
    cwd: stdin.cwd ?? process.cwd(),
    env: {
      ...(process.env.COLUMNS != null && { COLUMNS: process.env.COLUMNS }),
      ...(process.env.CLAUDE_CONFIG_DIR != null && {
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      }),
    },
    now: (deps.now ?? Date.now)(),
  };

  const outcome = await requestOnce(
    socketPath,
    request,
    deps.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
    deps.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS,
  );

  if (outcome.kind === 'ok') return outcome.output;

  if (outcome.kind === 'conn-error') {
    debug('daemon unreachable; cleaning up and respawning');
    try {
      fs.rmSync(socketPath, { force: true }); // idempotent under racing clients
    } catch {
      /* best effort */
    }
    spawnDaemonOnce(entryPath, homeDir, deps);
  }
  return null;
}
