import * as fs from 'node:fs';
import * as path from 'node:path';

/** Upstream / older builds stored HUD data under this plugin folder name. */
export const LEGACY_HUD_PLUGIN_DIRNAME = 'claude-hud';

/** This fork's plugin data folder (config, caches, statusline launcher). */
export const HUD_PLUGIN_DIRNAME = 'claude-hud-enhanced';

function expandHomeDirPrefix(inputPath: string, homeDir: string): string {
  if (inputPath === '~') {
    return homeDir;
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.join(homeDir, inputPath.slice(2));
  }
  return inputPath;
}

export function getClaudeConfigDir(homeDir: string): string {
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!envConfigDir) {
    return path.join(homeDir, '.claude');
  }
  return path.resolve(expandHomeDirPrefix(envConfigDir, homeDir));
}

export function getClaudeConfigJsonPath(homeDir: string): string {
  const configDir = getClaudeConfigDir(homeDir);
  // Claude Code stores the main config (with `oauthAccount`) in one of two
  // places depending on the profile:
  //   - the default `~/.claude` profile keeps it as the SIBLING `~/.claude.json`
  //   - a custom `CLAUDE_CONFIG_DIR` profile keeps it INSIDE the dir at
  //     `${CLAUDE_CONFIG_DIR}/.claude.json`
  // Prefer the inside file when it exists so custom profiles (e.g. a work
  // profile on a Team plan) resolve their own account, then fall back to the
  // sibling for the default profile.
  const insidePath = path.join(configDir, '.claude.json');
  if (fs.existsSync(insidePath)) {
    return insidePath;
  }
  return `${configDir}.json`;
}

// Rename seam so tests can exercise the cross-device (EXDEV) fallback, which is
// otherwise unreachable without a real second filesystem. Defaults to fs.renameSync.
let renameSyncImpl: (from: string, to: string) => void = (from, to) => fs.renameSync(from, to);

/** Test-only: override the rename used by the migration (null restores the default). */
export function _setRenameSyncImplForTests(impl: ((from: string, to: string) => void) | null): void {
  renameSyncImpl = impl ?? ((from, to) => fs.renameSync(from, to));
}

/**
 * One-time migration of HUD data dir from legacy `plugins/claude-hud` to
 * `plugins/claude-hud-enhanced`. Safe and idempotent:
 * - legacy missing → no-op
 * - enhanced missing → rename (or copy+remove on EXDEV)
 * - both exist → copy missing top-level files (e.g. config.json) into enhanced
 *   without overwriting; leave legacy in place
 */
export function migrateLegacyHudPluginDir(legacyDir: string, nextDir: string): void {
  try {
    if (!fs.existsSync(legacyDir)) {
      return;
    }

    if (!fs.existsSync(nextDir)) {
      try {
        renameSyncImpl(legacyDir, nextDir);
        return;
      } catch {
        // Cross-device rename can fail (EXDEV). Copy, then remove legacy so the
        // move actually completes and later invocations don't re-enter the
        // "both exist" branch on every statusline paint.
        fs.cpSync(legacyDir, nextDir, { recursive: true, force: false, errorOnExist: false });
        try {
          fs.rmSync(legacyDir, { recursive: true, force: true });
        } catch {
          // Enhanced dir is already populated; leave legacy if cleanup fails.
        }
        return;
      }
    }

    // Both exist: seed only name-agnostic files that are missing, without
    // clobbering. statusline.mjs is deliberately excluded — the legacy launcher
    // resolves the old `claude-hud` plugin dir, so copying it here would install
    // a wrong-name launcher; setup regenerates it fresh under the enhanced path.
    for (const name of ['config.json', 'previous-statusline.txt']) {
      const from = path.join(legacyDir, name);
      const to = path.join(nextDir, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.copyFileSync(from, to);
      }
    }
  } catch {
    // Never break the statusline for migration failures.
  }
}

export function getHudPluginDir(homeDir: string): string {
  const pluginsDir = path.join(getClaudeConfigDir(homeDir), 'plugins');
  const nextDir = path.join(pluginsDir, HUD_PLUGIN_DIRNAME);
  const legacyDir = path.join(pluginsDir, LEGACY_HUD_PLUGIN_DIRNAME);
  migrateLegacyHudPluginDir(legacyDir, nextDir);
  return nextDir;
}
