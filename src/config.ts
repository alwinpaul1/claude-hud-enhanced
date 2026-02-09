import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type LayoutType = 'default' | 'separators';

export type AutocompactBufferMode = 'enabled' | 'disabled';

export type ColorTheme = 'gray' | 'orange' | 'blue' | 'teal' | 'green' | 'lavender' | 'rose' | 'gold' | 'slate' | 'cyan';

export interface HudConfig {
  layout: LayoutType;
  pathLevels: 1 | 2 | 3;
  colorTheme: ColorTheme;
  gitStatus: {
    enabled: boolean;
    showDirty: boolean;
    showAheadBehind: boolean;
    showFileStats: boolean;
  };
  display: {
    showModel: boolean;
    showContextBar: boolean;
    showConfigCounts: boolean;
    showDuration: boolean;
    showTokenBreakdown: boolean;
    showUsage: boolean;
    showTools: boolean;
    showAgents: boolean;
    showTodos: boolean;
    showLastMessage: boolean;
    showSpeed: boolean;
    contextValue: 'percent' | 'tokens';
    usageBarEnabled: boolean;
    usageThreshold: number;
    sevenDayThreshold: number;
    environmentThreshold: number;
    autocompactBuffer: AutocompactBufferMode;
  };
}

export const DEFAULT_CONFIG: HudConfig = {
  layout: 'default',
  pathLevels: 1,
  colorTheme: 'blue',
  gitStatus: {
    enabled: true,
    showDirty: true,
    showAheadBehind: false,
    showFileStats: false,
  },
  display: {
    showModel: true,
    showContextBar: true,
    showConfigCounts: true,
    showDuration: true,
    showTokenBreakdown: true,
    showUsage: true,
    showTools: true,
    showAgents: true,
    showTodos: true,
    showLastMessage: false,
    showSpeed: false,
    contextValue: 'percent',
    usageBarEnabled: true,
    usageThreshold: 0,
    sevenDayThreshold: 80,
    environmentThreshold: 0,
    autocompactBuffer: 'enabled',
  },
};

export function getConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude', 'plugins', 'claude-hud', 'config.json');
}

function validatePathLevels(value: unknown): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function validateLayout(value: unknown): value is LayoutType {
  return value === 'default' || value === 'separators';
}

function validateAutocompactBuffer(value: unknown): value is AutocompactBufferMode {
  return value === 'enabled' || value === 'disabled';
}

function validateColorTheme(value: unknown): value is ColorTheme {
  return ['gray', 'orange', 'blue', 'teal', 'green', 'lavender', 'rose', 'gold', 'slate', 'cyan'].includes(value as string);
}

function mergeConfig(userConfig: Partial<HudConfig>): HudConfig {
  const layout = validateLayout(userConfig.layout)
    ? userConfig.layout
    : DEFAULT_CONFIG.layout;

  const pathLevels = validatePathLevels(userConfig.pathLevels)
    ? userConfig.pathLevels
    : DEFAULT_CONFIG.pathLevels;

  const colorTheme = validateColorTheme(userConfig.colorTheme)
    ? userConfig.colorTheme
    : DEFAULT_CONFIG.colorTheme;

  const gitStatus = {
    enabled: typeof userConfig.gitStatus?.enabled === 'boolean'
      ? userConfig.gitStatus.enabled
      : DEFAULT_CONFIG.gitStatus.enabled,
    showDirty: typeof userConfig.gitStatus?.showDirty === 'boolean'
      ? userConfig.gitStatus.showDirty
      : DEFAULT_CONFIG.gitStatus.showDirty,
    showAheadBehind: typeof userConfig.gitStatus?.showAheadBehind === 'boolean'
      ? userConfig.gitStatus.showAheadBehind
      : DEFAULT_CONFIG.gitStatus.showAheadBehind,
    showFileStats: typeof userConfig.gitStatus?.showFileStats === 'boolean'
      ? userConfig.gitStatus.showFileStats
      : DEFAULT_CONFIG.gitStatus.showFileStats,
  };

  const display = {
    showModel: typeof userConfig.display?.showModel === 'boolean'
      ? userConfig.display.showModel
      : DEFAULT_CONFIG.display.showModel,
    showContextBar: typeof userConfig.display?.showContextBar === 'boolean'
      ? userConfig.display.showContextBar
      : DEFAULT_CONFIG.display.showContextBar,
    showConfigCounts: typeof userConfig.display?.showConfigCounts === 'boolean'
      ? userConfig.display.showConfigCounts
      : DEFAULT_CONFIG.display.showConfigCounts,
    showDuration: typeof userConfig.display?.showDuration === 'boolean'
      ? userConfig.display.showDuration
      : DEFAULT_CONFIG.display.showDuration,
    showTokenBreakdown: typeof userConfig.display?.showTokenBreakdown === 'boolean'
      ? userConfig.display.showTokenBreakdown
      : DEFAULT_CONFIG.display.showTokenBreakdown,
    showUsage: typeof userConfig.display?.showUsage === 'boolean'
      ? userConfig.display.showUsage
      : DEFAULT_CONFIG.display.showUsage,
    showTools: typeof userConfig.display?.showTools === 'boolean'
      ? userConfig.display.showTools
      : DEFAULT_CONFIG.display.showTools,
    showAgents: typeof userConfig.display?.showAgents === 'boolean'
      ? userConfig.display.showAgents
      : DEFAULT_CONFIG.display.showAgents,
    showTodos: typeof userConfig.display?.showTodos === 'boolean'
      ? userConfig.display.showTodos
      : DEFAULT_CONFIG.display.showTodos,
    showLastMessage: typeof userConfig.display?.showLastMessage === 'boolean'
      ? userConfig.display.showLastMessage
      : DEFAULT_CONFIG.display.showLastMessage,
    showSpeed: typeof userConfig.display?.showSpeed === 'boolean'
      ? userConfig.display.showSpeed
      : DEFAULT_CONFIG.display.showSpeed,
    contextValue: userConfig.display?.contextValue === 'tokens'
      ? 'tokens'
      : DEFAULT_CONFIG.display.contextValue,
    usageBarEnabled: typeof userConfig.display?.usageBarEnabled === 'boolean'
      ? userConfig.display.usageBarEnabled
      : DEFAULT_CONFIG.display.usageBarEnabled,
    usageThreshold: typeof userConfig.display?.usageThreshold === 'number'
      ? userConfig.display.usageThreshold
      : DEFAULT_CONFIG.display.usageThreshold,
    sevenDayThreshold: typeof userConfig.display?.sevenDayThreshold === 'number'
      ? userConfig.display.sevenDayThreshold
      : DEFAULT_CONFIG.display.sevenDayThreshold,
    environmentThreshold: typeof userConfig.display?.environmentThreshold === 'number'
      ? userConfig.display.environmentThreshold
      : DEFAULT_CONFIG.display.environmentThreshold,
    autocompactBuffer: validateAutocompactBuffer(userConfig.display?.autocompactBuffer)
      ? userConfig.display.autocompactBuffer
      : DEFAULT_CONFIG.display.autocompactBuffer,
  };

  return { layout, pathLevels, colorTheme, gitStatus, display };
}

export async function loadConfig(): Promise<HudConfig> {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return DEFAULT_CONFIG;
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<HudConfig>;
    return mergeConfig(userConfig);
  } catch {
    return DEFAULT_CONFIG;
  }
}
