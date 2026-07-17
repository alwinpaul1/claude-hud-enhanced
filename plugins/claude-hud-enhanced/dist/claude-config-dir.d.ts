/** Upstream / older builds stored HUD data under this plugin folder name. */
export declare const LEGACY_HUD_PLUGIN_DIRNAME = "claude-hud";
/** This fork's plugin data folder (config, caches, statusline launcher). */
export declare const HUD_PLUGIN_DIRNAME = "claude-hud-enhanced";
export declare function getClaudeConfigDir(homeDir: string): string;
export declare function getClaudeConfigJsonPath(homeDir: string): string;
/**
 * One-time migration of HUD data dir from legacy `plugins/claude-hud` to
 * `plugins/claude-hud-enhanced`. Safe and idempotent:
 * - legacy missing → no-op
 * - enhanced missing → rename (or copy+remove on EXDEV)
 * - both exist → copy missing top-level files (e.g. config.json) into enhanced
 *   without overwriting; leave legacy in place
 */
export declare function migrateLegacyHudPluginDir(legacyDir: string, nextDir: string): void;
export declare function getHudPluginDir(homeDir: string): string;
//# sourceMappingURL=claude-config-dir.d.ts.map