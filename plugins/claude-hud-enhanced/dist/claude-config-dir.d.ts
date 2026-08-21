/** Upstream / older builds stored HUD data under this plugin folder name. */
export declare const LEGACY_HUD_PLUGIN_DIRNAME = "claude-hud";
/** This fork's plugin data folder (config, caches, statusline launcher). */
export declare const HUD_PLUGIN_DIRNAME = "claude-hud-enhanced";
export declare function getClaudeConfigDir(homeDir: string): string;
/**
 * Ordered candidate paths for the profile's main config JSON — the file that
 * carries `oauthAccount`, MCP servers, etc. — highest priority first.
 *
 * Claude Code stores that file in one of two places depending on the profile:
 *   - a custom `CLAUDE_CONFIG_DIR` profile keeps it INSIDE the dir at
 *     `${CLAUDE_CONFIG_DIR}/.claude.json`
 *   - the default `~/.claude` profile keeps it as the SIBLING `~/.claude.json`
 *
 * Both layouts can coexist: a default profile can carry an inside STUB
 * `~/.claude/.claude.json` (migration flags, no account) while the real
 * account sits in the sibling `~/.claude.json`. Returning both, inside-first,
 * lets a caller pick the file that actually holds what it needs instead of
 * trusting mere existence (see auth.ts, which reads the first file that has an
 * account rather than the first that exists).
 */
export declare function getClaudeConfigJsonCandidates(homeDir: string): string[];
export declare function getClaudeConfigJsonPath(homeDir: string): string;
/** Test-only: override the rename used by the migration (null restores the default). */
export declare function _setRenameSyncImplForTests(impl: ((from: string, to: string) => void) | null): void;
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