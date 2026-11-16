import { type ExtraSpend } from '../extra-usage.js';
import type { GitStatus } from '../git.js';
import type { BaseCompare, Pr, PrSnapshot } from '../pr-status.js';
import type { RenderContext } from '../types.js';
export type Tone = {
    bg: string;
    fg: string;
};
type ToneName = 'green' | 'purple' | 'red' | 'mint' | 'blue' | 'gold' | 'tray';
type InkName = 'text' | 'subtle' | 'success' | 'warning' | 'error';
export type Palette = Record<ToneName, Tone> & {
    ink: Record<InkName, string>;
};
export declare const paletteFor: (theme: string | null | undefined) => Palette;
export interface PillWindow {
    percentUsed: number;
    resetsAt: number | null;
    seenAt?: number | null;
    isRolled?: boolean;
}
export interface PillScoped {
    label: string;
    window: PillWindow;
}
export interface PillContext {
    tokens: number | null;
    window: number;
    percent: number | null;
}
export interface PillModel {
    name: string;
    effort: string | null;
}
export interface PillGit {
    worktree: string;
    isLinked: boolean;
    branch: string;
    ahead: number;
    behind: number;
    staged: number;
    modified: number;
    untracked: number;
    conflicts: number;
    pr: Pr | null;
    isCheckedOut?: boolean;
    base?: BaseCompare;
    isDirtyUncounted?: boolean;
}
export interface PillAgent {
    type: string;
    model: string;
    modelId: string;
    effort: string | null;
    tokens: number | null;
    window?: number;
    git?: PillGit | null;
}
export interface PillBand {
    context: PillContext | null;
    model: PillModel | null;
    fiveHour: PillWindow | null;
    sevenDay: PillWindow | null;
    noLimit?: {
        fiveHour?: boolean;
        sevenDay?: boolean;
    };
    scoped?: PillScoped[];
    extra?: ExtraSpend | null;
    git: PillGit | null;
    folder: string | null;
    agents: PillAgent[];
}
export type Seg = {
    key: string;
    text: string;
    color?: string;
    bold?: boolean;
};
export type PillSpec = {
    key: string;
    tone: Tone;
    full: Seg[];
    compact: Seg[];
    tight: Seg[];
    fit?: (cells: number) => Seg[] | null;
};
export declare const compact: (n: number) => string;
export declare const modelName: (id: string) => string;
export declare const resetLabel: (at: number, now: number) => string;
export declare const clip: (segs: Seg[], cells: number) => Seg[];
export declare const layout: (pills: PillSpec[], columns: number, capWidth: number, oneRow?: boolean) => [PillSpec, Seg[]][][];
export declare const agentWindow: (a: PillAgent, main: PillModel | null, ctx: PillContext | null) => number | null;
export declare const contextSpec: (ctx: PillContext | null, mdl: PillModel | null, p: Palette) => PillSpec;
export declare const agentContextSpec: (a: PillAgent, main: PillModel | null, ctx: PillContext | null, p: Palette) => PillSpec;
export declare const rolled: (w: PillWindow, now: number, span: number) => PillWindow;
export declare const STALE_AFTER = 150000;
export declare const MAX_SCOPED_PILLS = 2;
export declare const agoLabel: (ms: number) => string;
export declare const windowNote: (w: PillWindow, now: number) => string | null;
export declare const windowSpec: (label: string, icon: string, seen: PillWindow, now: number, tone: Tone, p: Palette, span?: number, key?: string) => PillSpec;
export declare const noLimitSpec: (label: string, icon: string, p: Palette) => PillSpec;
export declare const extraSpec: (spend: ExtraSpend, p: Palette) => PillSpec;
export declare const prBadge: (pr: Pr, p: Palette) => {
    state: Seg[];
    checks: Seg[];
};
export declare const gitSpec: (r: PillGit, p: Palette) => PillSpec;
export declare const folderSpec: (name: string, p: Palette) => PillSpec;
export declare const drawPill: (spec: PillSpec, segs: Seg[], p: Palette, caps: boolean) => string;
export interface PillOptions {
    palette: Palette;
    caps: boolean;
    now: number;
    maxRows?: number | null;
}
export declare const pillRows: (band: PillBand, columns: number, options: PillOptions) => [PillSpec, Seg[]][][];
export declare const renderPillBand: (band: PillBand, columns: number, options: PillOptions) => string[];
export declare const gitFromStatus: (status: GitStatus, fallbackName: string, snapshot: PrSnapshot | null | undefined) => PillGit;
export declare const bandFromContext: (ctx: RenderContext) => PillBand;
export declare const renderPillLines: (ctx: RenderContext, columns: number | null, now?: number) => string[];
export {};
//# sourceMappingURL=pills.d.ts.map