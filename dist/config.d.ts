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
        autocompactBuffer: AutocompactBufferMode;
    };
}
export declare const DEFAULT_CONFIG: HudConfig;
export declare function getConfigPath(): string;
export declare function loadConfig(): Promise<HudConfig>;
//# sourceMappingURL=config.d.ts.map