import { DEFAULT_CONFIG } from '../config.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { critical, cyan, green, label, magenta, warning } from './colors.js';
import { paletteFor, prBadge } from './pills.js';
import { clipPlain } from './visual.js';
/**
 * Resolve VCS-specific visibility once so compact and expanded layouts cannot
 * drift. jj never inherits Git-only ahead/behind or file-stat settings.
 */
export function getVcsDisplayState(status, config) {
    if (!status)
        return null;
    const kind = status.vcs === 'jj' ? 'jj' : 'git';
    const gitConfig = config.gitStatus ?? DEFAULT_CONFIG.gitStatus;
    const jjConfig = config.jjStatus ?? DEFAULT_CONFIG.jjStatus;
    const enabled = kind === 'jj' ? jjConfig.enabled : gitConfig.enabled;
    if (!enabled)
        return null;
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
export const MIN_BRANCH_CELLS = 8;
export const vcsLabel = (vcs) => (vcs.kind === 'jj' ? 'jj:(' : vcs.linked ? 'wt:(' : 'git:(');
export const clipBranch = (branch, cells) => clipPlain(branch, Math.max(MIN_BRANCH_CELLS, cells));
const BADGE_PALETTE = paletteFor('dark');
function paintBadge(text, color, colors) {
    if (color === BADGE_PALETTE.green.fg)
        return green(text);
    if (color === BADGE_PALETTE.red.fg)
        return critical(text, colors);
    if (color === BADGE_PALETTE.gold.fg)
        return warning(text, colors);
    if (color === BADGE_PALETTE.purple.fg)
        return magenta(text);
    if (color === BADGE_PALETTE.blue.fg)
        return cyan(text);
    return label(text, colors);
}
function paintPrNumber(pr, colors) {
    const text = `#${pr.number}`;
    if (pr.state === 'OPEN')
        return green(text);
    if (pr.state === 'MERGED')
        return magenta(text);
    if (pr.state === 'CLOSED')
        return critical(text, colors);
    return label(text, colors);
}
export function currentPr(snapshot) {
    return snapshot && !snapshot.own ? snapshot.pr : null;
}
export function formatPrBadge(pr, colors, detail = 'full') {
    const number = paintPrNumber(pr, colors);
    if (detail !== 'full')
        return number;
    const badge = prBadge(pr, BADGE_PALETTE);
    const words = [...badge.state, ...badge.checks].map((seg) => paintBadge(seg.text.trim(), seg.color, colors));
    return [number, ...words].join(' ');
}
//# sourceMappingURL=vcs-status.js.map