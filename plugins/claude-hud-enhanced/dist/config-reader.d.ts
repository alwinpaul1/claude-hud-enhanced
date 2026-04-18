export interface ConfigCounts {
    claudeMdCount: number;
    rulesCount: number;
    mcpCount: number;
    hooksCount: number;
    outputStyle?: string;
    effortLevel?: string;
}
/**
 * Detect --effort flag from the parent Claude Code process args.
 * Cached per process lifetime since ppid doesn't change within a session.
 */
export declare function detectSessionEffort(): string | undefined;
export declare function _resetSessionEffortCacheForTests(): void;
export declare function countConfigs(cwd?: string): Promise<ConfigCounts>;
//# sourceMappingURL=config-reader.d.ts.map