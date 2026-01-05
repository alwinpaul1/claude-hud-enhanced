export interface ConfigCounts {
    claudeMdCount: number;
    rulesCount: number;
    mcpCount: number;
    hooksCount: number;
}
export declare function countConfigs(cwd?: string): Promise<ConfigCounts>;
//# sourceMappingURL=config-reader.d.ts.map