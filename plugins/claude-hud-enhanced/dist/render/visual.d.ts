export declare const ANSI_ESCAPE_PATTERN: RegExp;
export declare function stripAnsi(str: string): string;
export declare function segmentGraphemes(text: string): string[];
export declare function graphemeWidth(grapheme: string, ambiguousWide: boolean): number;
export declare function visualLength(str: string): number;
export declare function sliceVisible(str: string, maxVisible: number): string;
export declare function closeOpenHyperlink(str: string): string;
export declare function truncateToWidth(str: string, maxWidth: number): string;
export declare function clipToWidth(str: string, maxWidth: number): string;
export declare function clipPlain(text: string, maxCells: number): string;
export type Fits = (line: string) => boolean;
export declare const fitsWidth: (maxWidth: number | null | undefined) => Fits | undefined;
export declare function firstFitting(candidates: Array<() => string>, fits: Fits | undefined): string;
//# sourceMappingURL=visual.d.ts.map