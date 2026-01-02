/**
 * Simple logger for claude-hud
 *
 * Logs to stderr to avoid interfering with TUI output.
 * In production, errors are logged silently to not disrupt the UI.
 */

const DEBUG = process.env.CLAUDE_HUD_DEBUG === '1';

export const logger = {
  debug: (context: string, message: string, data?: unknown): void => {
    if (DEBUG) {
      console.error(`[DEBUG] [${context}] ${message}`, data ?? '');
    }
  },

  warn: (context: string, message: string, error?: unknown): void => {
    if (DEBUG) {
      console.error(`[WARN] [${context}] ${message}`, error ?? '');
    }
  },

  error: (context: string, message: string, error?: unknown): void => {
    if (DEBUG) {
      console.error(`[ERROR] [${context}] ${message}`, error ?? '');
    }
  },
};
