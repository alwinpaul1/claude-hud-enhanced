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
  return `${getClaudeConfigDir(homeDir)}.json`;
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
        fs.renameSync(legacyDir, nextDir);
        return;
      } catch {
        // Cross-device rename can fail (EXDEV). Fall through to copy.
        fs.cpSync(legacyDir, nextDir, { recursive: true, force: false, errorOnExist: false });
        return;
      }
    }

    // Both exist: seed config.json (and only missing files) without clobbering.
    for (const name of ['config.json', 'previous-statusline.txt', 'statusline.mjs']) {
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
