/**
 * Simple logger for claude-hud
 *
 * - Errors always logged to file for production visibility
 * - Debug/warn only logged when CLAUDE_HUD_DEBUG=1
 * - Logs to file in ~/.claude/hud/logs/hud.log (rotates at 1MB)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const DEBUG = process.env.CLAUDE_HUD_DEBUG === '1';
const LOG_DIR = path.join(os.homedir(), '.claude', 'hud', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'hud.log');
const MAX_LOG_SIZE_BYTES = 1024 * 1024; // 1MB

let logDirCreated = false;
let logFileHandle: fs.WriteStream | null = null;

function ensureLogDir(): boolean {
  if (logDirCreated) return true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    logDirCreated = true;
    return true;
  } catch {
    return false;
  }
}

function rotateLogIfNeeded(): void {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > MAX_LOG_SIZE_BYTES) {
      const rotatedFile = `${LOG_FILE}.1`;
      if (fs.existsSync(rotatedFile)) {
        fs.unlinkSync(rotatedFile);
      }
      fs.renameSync(LOG_FILE, rotatedFile);
      if (logFileHandle) {
        logFileHandle.close();
        logFileHandle = null;
      }
    }
  } catch {
    // File doesn't exist yet or rotation failed - continue anyway
  }
}

function getLogStream(): fs.WriteStream | null {
  if (logFileHandle) return logFileHandle;
  if (!ensureLogDir()) return null;
  rotateLogIfNeeded();
  try {
    logFileHandle = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    return logFileHandle;
  } catch {
    return null;
  }
}

function writeToFile(level: string, context: string, message: string, data?: unknown): void {
  const stream = getLogStream();
  if (!stream) return;
  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  stream.write(`${timestamp} [${level}] [${context}] ${message}${dataStr}\n`);
}

export const logger = {
  debug: (context: string, message: string, data?: unknown): void => {
    if (DEBUG) {
      writeToFile('DEBUG', context, message, data);
      console.error(`[DEBUG] [${context}] ${message}`, data ?? '');
    }
  },

  warn: (context: string, message: string, error?: unknown): void => {
    if (DEBUG) {
      writeToFile('WARN', context, message, error);
      console.error(`[WARN] [${context}] ${message}`, error ?? '');
    }
  },

  error: (context: string, message: string, error?: unknown): void => {
    // Errors ALWAYS logged to file for production visibility
    writeToFile('ERROR', context, message, error);
    if (DEBUG) {
      console.error(`[ERROR] [${context}] ${message}`, error ?? '');
    }
  },

  /** Close the log file stream (for clean shutdown) */
  close: (): void => {
    if (logFileHandle) {
      logFileHandle.close();
      logFileHandle = null;
    }
  },
};
