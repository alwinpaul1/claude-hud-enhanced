import { DEFAULT_CONFIG } from '../config.js';
import type { HudConfig, GitBranchOverflowMode } from '../config.js';
import type { GitStatus, FileStats, LineDiff } from '../git.js';
import type { HudColorOverrides } from '../config.js';
import type { Pr, PrSnapshot } from '../pr-status.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { critical, cyan, green, label, magenta, warning } from './colors.js';
import { paletteFor, prBadge } from './pills.js';
import { clipPlain } from './visual.js';

export interface VcsDisplayState {
  kind: 'git' | 'jj';
  branch: string;
  dirty: boolean;
  conflict: boolean;
  ahead: number;
  behind: number;
  fileStats?: FileStats;
  lineDiff?: LineDiff;
  branchUrl?: string;
  branchOverflow: GitBranchOverflowMode;
  linked: boolean;
}

/**
 * Resolve VCS-specific visibility once so compact and expanded layouts cannot
 * drift. jj never inherits Git-only ahead/behind or file-stat settings.
 */
export function getVcsDisplayState(
  status: GitStatus | null,
  config: Pick<Partial<HudConfig>, 'gitStatus' | 'jjStatus'>,
): VcsDisplayState | null {
  if (!status) return null;

  const kind = status.vcs === 'jj' ? 'jj' : 'git';
  const gitConfig = config.gitStatus ?? DEFAULT_CONFIG.gitStatus;
  const jjConfig = config.jjStatus ?? DEFAULT_CONFIG.jjStatus;
  const enabled = kind === 'jj' ? jjConfig.enabled : gitConfig.enabled;
  if (!enabled) return null;

  const showDirty = kind === 'jj' ? jjConfig.showDirty : gitConfig.showDirty;
  const isGit = kind === 'git';

  return {
    kind,
    branch: sanitizeDisplayText(status.branch),
    dirty: showDirty && status.isDirty,
    conflict: kind === 'jj' && jjConfig.showConflicts && status.conflict === true,
    ahead: isGit && gitConfig.showAheadBehind ? status.ahead : 0,
    behind: isGit && gitConfig.showAheadBehind ? status.behind : 0,
    fileStats: isGit && gitConfig.showFileStats ? status.fileStats : undefined,
    lineDiff: isGit && gitConfig.showFileStats ? status.lineDiff : undefined,
    branchUrl: isGit ? status.branchUrl : undefined,
    branchOverflow: gitConfig.branchOverflow,
    linked: isGit && status.isLinked === true,
  };
}

export type GitDetail = 'full' | 'brief' | 'clipped' | 'none';

export const MIN_BRANCH_CELLS = 8;

export const vcsLabel = (vcs: VcsDisplayState): string => (vcs.kind === 'jj' ? 'jj:(' : vcs.linked ? 'wt:(' : 'git:(');

export const clipBranch = (branch: string, cells: number): string => clipPlain(branch, Math.max(MIN_BRANCH_CELLS, cells));

const BADGE_PALETTE = paletteFor('dark');

type Colors = Partial<HudColorOverrides> | undefined;

function paintBadge(text: string, color: string | undefined, colors: Colors): string {
  if (color === BADGE_PALETTE.green.fg) return green(text);
  if (color === BADGE_PALETTE.red.fg) return critical(text, colors);
  if (color === BADGE_PALETTE.gold.fg) return warning(text, colors);
  if (color === BADGE_PALETTE.purple.fg) return magenta(text);
  if (color === BADGE_PALETTE.blue.fg) return cyan(text);
  return label(text, colors);
}

function paintPrNumber(pr: Pr, colors: Colors): string {
  const text = `#${pr.number}`;
  if (pr.state === 'OPEN') return green(text);
  if (pr.state === 'MERGED') return magenta(text);
  if (pr.state === 'CLOSED') return critical(text, colors);
  return label(text, colors);
}

export function currentPr(snapshot: PrSnapshot | null | undefined): Pr | null {
  return snapshot && !snapshot.own ? snapshot.pr : null;
}

export function formatPrBadge(pr: Pr, colors: Colors, detail: GitDetail = 'full'): string {
  const number = paintPrNumber(pr, colors);
  if (detail !== 'full') return number;
  const badge = prBadge(pr, BADGE_PALETTE);
  const words = [...badge.state, ...badge.checks].map((seg) => paintBadge(seg.text.trim(), seg.color, colors));

  return [number, ...words].join(' ');
}
