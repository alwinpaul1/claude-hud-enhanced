import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClaudeConfigDir, getHudPluginDir } from './claude-config-dir.js';
import type { StdinData } from './types.js';

/**
 * Shared IPC pieces for warm daemon mode (docs/daemon-mode-design.md):
 * per-profile socket/pipe path, newline-delimited-JSON framing, and the
 * plugin's own version (for the client↔daemon handshake).
 */

export const IPC_PROTOCOL_VERSION = 1;
/** Reject absurd frames instead of buffering without bound. */
export const MAX_FRAME_BYTES = 1024 * 1024;

export interface DaemonRequest {
  v: number;
  pluginVersion: string;
  stdin: StdinData;
  cwd: string;
  env: { COLUMNS?: string; CLAUDE_CONFIG_DIR?: string };
  now: number;
}

export interface DaemonResponse {
  v: number;
  pluginVersion: string;
  output: string | null;
  willExit: boolean;
}

export function getIpcDir(homeDir: string = os.homedir()): string {
  return path.join(getHudPluginDir(homeDir), 'daemon');
}

export function getIpcPath(homeDir: string = os.homedir()): string {
  if (process.platform === 'win32') {
    // Pipe names are a flat machine-global namespace, so per-profile
    // uniqueness must be hashed into the name (phase 2 target).
    const key = createHash('sha256')
      .update(path.resolve(getClaudeConfigDir(homeDir)))
      .digest('hex')
      .slice(0, 16);
    return `\\\\.\\pipe\\claude-hud-enhanced-${key}`;
  }
  // Unix: getHudPluginDir is already per-profile — no hashing needed.
  const preferred = path.join(getIpcDir(homeDir), 'hud.sock');

  // Fall back to a native, short, per-profile-hashed 0700 SUBDIR when the
  // preferred path can't host a working native socket:
  //   - >100 bytes → bind() fails EINVAL past the ~104-byte sun_path limit
  //     (deep CLAUDE_CONFIG_DIRs / long home paths);
  //   - under a WSL DrvFS mount (/mnt/c/…) → AF_UNIX there interops with the
  //     Windows namespace and neither binds nor connects like a native
  //     socket, otherwise causing endless doomed respawns.
  // The 0700 SUBDIR (created via ensurePrivateDir) is the access guard on
  // every platform — deliberately not relying on socket FILE permissions,
  // whose enforcement on connect() is historically inconsistent across Unix
  // flavors (Linux enforces; some BSDs ignore — not verified per-host). A
  // squatter pre-creating the name only degrades that profile to inline mode
  // (EADDRINUSE → daemon exits, clients keep rendering inline) — never breaks
  // the HUD.
  const onDrvFs = /^\/mnt\/[a-z]\//i.test(preferred);
  // Byte length, not UTF-16 code units: sun_path is byte-limited (~103 usable
  // on macOS) and a multi-byte character in a home path (accented username)
  // would be under-counted by .length, passing the check yet failing bind().
  if (!onDrvFs && Buffer.byteLength(preferred, 'utf8') <= 100) return preferred;

  const key = createHash('sha256')
    .update(path.resolve(getClaudeConfigDir(homeDir)))
    .digest('hex')
    .slice(0, 16);
  // XDG_RUNTIME_DIR (/run/user/<uid>, tmpfs, 0700) is ideal on Linux/WSL;
  // tmpdir otherwise. Caveat (accepted): a user who exported TMPDIR to a
  // DrvFS path for interop lands the fallback back on DrvFS — niche, and it
  // degrades to inline mode, not breakage (not verified per-host).
  const runtimeBase = process.env.XDG_RUNTIME_DIR?.trim() || os.tmpdir();
  return path.join(runtimeBase, `claude-hud-${key}`, 'hud.sock');
}

export function getSpawnLockPath(homeDir: string = os.homedir()): string {
  return path.join(getIpcDir(homeDir), 'hud.spawn.lock');
}

export function getPidPath(homeDir: string = os.homedir()): string {
  return path.join(getIpcDir(homeDir), 'hud.pid');
}

/**
 * This PLUGIN's version (package.json one level above src/ and dist/ alike) —
 * distinct from version.ts, which resolves the `claude` CLI's version.
 */
export function getPluginVersion(): string {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0';
  } catch {
    return '0';
  }
}

/**
 * Newline-delimited JSON framing. JSON.stringify escapes literal newlines
 * inside string values, so a serialized message can never contain a raw
 * newline byte — splitting the stream on '\n' is unambiguous.
 */
export function encodeMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Incremental decoder: feed socket chunks in, complete messages come out.
 * Malformed JSON frames are surfaced as null so callers can fail the request
 * instead of hanging. Oversized buffers reset (a peer that sends >1MB without
 * a newline is broken by definition).
 */
export function createLineDecoder(
  onMessage: (message: unknown | null) => void,
): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    if (buffer.length > MAX_FRAME_BYTES) {
      buffer = '';
      onMessage(null);
      return;
    }
    for (;;) {
      const nl = buffer.indexOf('\n');
      if (nl === -1) return;
      const raw = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      try {
        onMessage(JSON.parse(raw));
      } catch {
        onMessage(null);
      }
    }
  };
}
