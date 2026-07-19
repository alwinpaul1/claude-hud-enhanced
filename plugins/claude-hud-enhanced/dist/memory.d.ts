import type { MemoryInfo } from './types.js';
type MemResult = {
    totalBytes: number;
    freeBytes: number;
};
type MemoryReader = () => MemResult | Promise<MemResult>;
export declare function parseVmStat(output: string): {
    pageSize: number;
    active: number;
    wired: number;
} | null;
export declare function parseLinuxMeminfo(output: string): {
    totalBytes: number;
    freeBytes: number;
} | null;
export declare function getMemoryUsage(): Promise<MemoryInfo | null>;
export declare function formatBytes(bytes: number): string;
export declare function _setMemoryReaderForTests(reader: MemoryReader | null): void;
export {};
//# sourceMappingURL=memory.d.ts.map