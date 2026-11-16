import { extraSpend, spendRatio, spentText, type ExtraSpend } from '../extra-usage.js';
import type { GitStatus } from '../git.js';
import type { BaseCompare, Pr, PrSnapshot, Readiness } from '../pr-status.js';
import { formatModelName, getContextPercent, getTotalTokens, resolveModelName, shouldHideUsage } from '../stdin.js';
import { knownWindows, type SubagentSeen } from '../subagents.js';
import type { RenderContext } from '../types.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { RESET } from './colors.js';
import { formatProjectPath } from './project-path.js';
import { codePointCellWidth, isCjkAmbiguousWide } from './width.js';

const BAR = 8;
const LIMIT_AT = 100;
const HOUR = 3_600_000;
const SPAN: Record<string, number> = { '5h': 5 * HOUR, '7d': 7 * 24 * HOUR };
const MIN_BRANCH = 8;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CAP_LEFT = '';
const CAP_RIGHT = '';
const BOLD = '\x1b[1m';
const NORMAL = '\x1b[22m';

export type Tone = { bg: string; fg: string };
type ToneName = 'green' | 'purple' | 'red' | 'mint' | 'blue' | 'gold' | 'tray';
type InkName = 'text' | 'subtle' | 'success' | 'warning' | 'error';
export type Palette = Record<ToneName, Tone> & { ink: Record<InkName, string> };

const LIGHT: Palette = {
  green: { bg: 'rgb(221,236,226)', fg: 'rgb(62,134,84)' },
  purple: { bg: 'rgb(233,228,247)', fg: 'rgb(118,92,196)' },
  red: { bg: 'rgb(247,226,220)', fg: 'rgb(196,92,64)' },
  mint: { bg: 'rgb(224,238,226)', fg: 'rgb(62,134,84)' },
  blue: { bg: 'rgb(226,230,250)', fg: 'rgb(84,100,220)' },
  gold: { bg: 'rgb(243,236,216)', fg: 'rgb(160,120,30)' },
  tray: { bg: 'rgb(238,238,236)', fg: 'rgb(110,110,110)' },
  ink: {
    text: 'rgb(0,0,0)',
    subtle: 'rgb(175,175,175)',
    success: 'rgb(44,122,57)',
    warning: 'rgb(150,108,30)',
    error: 'rgb(171,43,63)',
  },
};
const DARK: Palette = {
  green: { bg: 'rgb(36,58,44)', fg: 'rgb(122,200,146)' },
  purple: { bg: 'rgb(52,44,76)', fg: 'rgb(184,164,245)' },
  red: { bg: 'rgb(72,44,38)', fg: 'rgb(240,146,120)' },
  mint: { bg: 'rgb(38,60,46)', fg: 'rgb(122,200,146)' },
  blue: { bg: 'rgb(40,46,80)', fg: 'rgb(146,164,255)' },
  gold: { bg: 'rgb(66,56,32)', fg: 'rgb(232,194,102)' },
  tray: { bg: 'rgb(34,34,34)', fg: 'rgb(150,150,150)' },
  ink: {
    text: 'rgb(255,255,255)',
    subtle: 'rgb(80,80,80)',
    success: 'rgb(78,186,101)',
    warning: 'rgb(255,193,7)',
    error: 'rgb(255,107,128)',
  },
};

export const paletteFor = (theme: string | null | undefined): Palette => (theme?.startsWith('light') ? LIGHT : DARK);

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
  noLimit?: { fiveHour?: boolean; sevenDay?: boolean };
  scoped?: PillScoped[];
  extra?: ExtraSpend | null;
  git: PillGit | null;
  folder: string | null;
  agents: PillAgent[];
}

export type Seg = { key: string; text: string; color?: string; bold?: boolean };

export type PillSpec = {
  key: string;
  tone: Tone;
  full: Seg[];
  compact: Seg[];
  tight: Seg[];
  fit?: (cells: number) => Seg[] | null;
};

export const compact = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`;

export const modelName = (id: string): string => {
  const m = /^claude-([a-z]+)((?:-\d{1,2}(?=-|$))+)/.exec(id.replace(/\[.*\]$/, ''));
  if (!m) return id;
  const family = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1);
  const version = (m[2] ?? '').slice(1).split('-').join('.');

  return `${family} ${version}`;
};

const pad = (n: number): string => `${n}`.padStart(2, '0');

export const resetLabel = (at: number, now: number): string => {
  const d = new Date(at);
  const hours = d.getHours();
  const time = `${hours % 12 || 12}:${pad(d.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;

  return d.toDateString() === new Date(now).toDateString() ? time : `${DAYS[d.getDay()]} ${time}`;
};

const cellWidth = (text: string): number => {
  const ambiguousWide = isCjkAmbiguousWide();
  let cells = 0;
  for (const char of text) cells += codePointCellWidth(char.codePointAt(0) ?? 0, ambiguousWide);
  return cells;
};

const segWidth = (segs: Seg[]): number => segs.reduce((n, s) => n + cellWidth(s.text), 0);

const BOLD_PILLS = new Set(['context', '5h', '7d']);

export const clip = (segs: Seg[], cells: number): Seg[] => {
  if (segWidth(segs) <= cells) return segs;
  const out: Seg[] = [];
  let left = Math.max(0, cells - 1);
  for (const seg of segs) {
    const width = cellWidth(seg.text);
    if (width > left) {
      let text = '';
      for (const char of seg.text) {
        if (cellWidth(text + char) > left) break;
        text += char;
      }
      if (text !== '') out.push({ ...seg, text });
      break;
    }
    out.push(seg);
    left -= width;
  }
  while (out.length > 0 && /^[\s│·/]*$/.test(out[out.length - 1]?.text ?? '')) out.pop();
  const last = out.pop();

  return [...out, ...(last ? [{ ...last, text: last.text.replace(/[\s│·/]+$/, '') }] : []), { key: 'cut', text: '…' }];
};

export const layout = (
  pills: PillSpec[],
  columns: number,
  capWidth: number,
  oneRow: boolean = false,
): [PillSpec, Seg[]][][] => {
  const width = (segs: Seg[]): number => segWidth(segs) + capWidth;
  const rowWidth = (segs: Seg[][]): number => segs.reduce((n, x) => n + width(x), 0) + Math.max(0, segs.length - 1);
  const full = (x: PillSpec): Seg[] => x.full;
  if (rowWidth(pills.map(full)) <= columns) return [pills.map((x) => [x, full(x)])];
  if (oneRow) {
    for (const pick of [(x: PillSpec) => x.compact, (x: PillSpec) => x.tight]) {
      if (rowWidth(pills.map(pick)) <= columns) return [pills.map((x) => [x, pick(x)])];
    }
  }
  const own = pills.find((x) => x.fit);
  const rest = pills.filter((x) => x !== own);
  const ownSegs = own
    ? width(own.full) <= columns
      ? own.full
      : width(own.compact) <= columns
        ? own.compact
        : (own.fit?.(columns - capWidth) ?? clip(own.tight, columns - capWidth))
    : null;
  if (own && ownSegs && rowWidth(rest.map(full)) <= columns) return [rest.map((x) => [x, full(x)]), [[own, ownSegs]]];
  if (rowWidth(pills.map((x) => x.compact)) <= columns) return [pills.map((x) => [x, x.compact])];
  for (const pick of [(x: PillSpec) => x.compact, (x: PillSpec) => x.tight]) {
    if (rowWidth(rest.map(pick)) > columns) continue;
    const first: [PillSpec, Seg[]][] = rest.map((x) => [x, pick(x)]);
    if (!own || !ownSegs) return [first];
    return [first, [[own, ownSegs]]];
  }
  const sized = (x: PillSpec): Seg[] => {
    const segs = [...(oneRow ? [] : [x.compact]), x.tight].find((option) => width(option) <= columns);
    return segs ?? clip(x.tight, columns - capWidth);
  };
  const flow = (list: PillSpec[]): [PillSpec, Seg[]][][] => {
    const rows: [PillSpec, Seg[]][][] = [];
    for (const x of list) {
      const segs = sized(x);
      const row = rows[rows.length - 1];
      if (row && rowWidth([...row.map(([, placed]) => placed), segs]) <= columns) row.push([x, segs]);
      else rows.push([[x, segs]]);
    }

    return rows;
  };
  const packed = flow(rest);
  const [head, ...tail] = rest;
  const led = head ? [...flow([head]), ...flow(tail)] : packed;
  const pairs = (rows: [PillSpec, Seg[]][][]): boolean =>
    rows.some((row) => ['5h', '7d'].every((key) => row.some(([x]) => x.key === key)));
  const rows = led.length === packed.length && pairs(led) && !pairs(packed) ? led : packed;

  return own && ownSegs ? [...rows, [[own, ownSegs]]] : rows;
};

const meter = (key: string, percent: number, calm: string, p: Palette): Seg[] => {
  const halves = Math.max(0, Math.min(BAR * 2, Math.round((percent / 100) * BAR * 2)));
  const accent = percent >= 90 ? p.red.fg : percent >= 75 ? p.gold.fg : calm;
  const full = Math.floor(halves / 2);
  const half = halves % 2 === 1;

  return [
    { key: `${key}-fill`, text: '━'.repeat(full) + (half ? '╸' : ''), color: accent },
    { key: `${key}-track`, text: '━'.repeat(BAR - full - (half ? 1 : 0)), color: 'subtle' },
  ];
};

export const agentWindow = (a: PillAgent, main: PillModel | null, ctx: PillContext | null): number | null =>
  a.window ??
  (main !== null && ctx !== null && ctx.window > 0 && a.model === main.name ? ctx.window : null) ??
  knownWindows.get(a.modelId) ??
  null;

export const contextSpec = (ctx: PillContext | null, mdl: PillModel | null, p: Palette): PillSpec => {
  const percent = ctx?.percent ?? null;
  const lead: Seg[] =
    mdl === null
      ? []
      : [
          { key: 'model', text: ` ${mdl.name} `, color: 'text', bold: true },
          ...(mdl.effort === null ? [] : [{ key: 'effort', text: `${mdl.effort} `, color: p.blue.fg }]),
          { key: 'sep', text: '│', color: p.tray.fg },
        ];
  const icon: Seg = { key: 'icon', text: ' ◔ ', color: p.blue.fg };
  if (percent === null) {
    const none = [...lead, icon, { key: 'ctx-none', text: '— ', color: p.tray.fg }];
    return { key: 'context', tone: p.blue, full: none, compact: none, tight: none };
  }
  const pct: Seg = { key: 'ctx-pct', text: ` ${Math.round(percent)}%`, color: 'text', bold: true };
  const size: Seg = {
    key: 'ctx-size',
    text: ` ${compact(ctx?.tokens ?? 0)}/${compact(ctx?.window ?? 0)} `,
    color: p.tray.fg,
  };

  return {
    key: 'context',
    tone: p.blue,
    full: [...lead, icon, ...meter('ctx', percent, p.blue.fg, p), pct, size],
    compact: [...lead, icon, { ...pct, text: `${Math.round(percent)}% ` }],
    tight: [
      ...lead.filter((x) => x.key !== 'sep'),
      { ...icon, text: '◔ ' },
      { ...pct, text: `${Math.round(percent)}% ` },
    ],
  };
};

export const agentContextSpec = (a: PillAgent, main: PillModel | null, ctx: PillContext | null, p: Palette): PillSpec => {
  const window = agentWindow(a, main, ctx);
  const own: PillContext = {
    tokens: a.tokens,
    window: window ?? 0,
    percent: a.tokens === null || window === null ? null : (a.tokens / window) * 100,
  };
  const base = contextSpec(own, { name: a.model, effort: a.effort }, p);
  const tokens = a.tokens;
  const tokensOnly = (segs: Seg[]): Seg[] =>
    segs.map((x) => (x.key === 'ctx-none' && tokens !== null ? { ...x, text: `${compact(tokens)} ` } : x));
  const spec =
    window === null
      ? { ...base, full: tokensOnly(base.full), compact: tokensOnly(base.compact), tight: tokensOnly(base.tight) }
      : base;
  const who: Seg = { key: 'agent', text: ` ↳ ${a.type} ·`, color: p.blue.fg, bold: true };

  return { ...spec, full: [who, ...spec.full], compact: [who, ...spec.compact], tight: [who, ...spec.tight] };
};

export const rolled = (w: PillWindow, now: number, span: number): PillWindow => {
  if (w.resetsAt === null || !(span > 0)) return w;
  let at = w.resetsAt;
  if (at > now) return w;
  while (at <= now) at += span;

  return { percentUsed: 0, resetsAt: at, isRolled: true };
};

export const STALE_AFTER = 150_000;
export const MAX_SCOPED_PILLS = 2;

export const agoLabel = (ms: number): string => {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

export const windowNote = (w: PillWindow, now: number): string | null => {
  if (w.isRolled) return 'reset';
  if (w.seenAt === undefined) return null;
  if (w.seenAt === null) return 'unconfirmed';
  return now - w.seenAt > STALE_AFTER ? `${agoLabel(now - w.seenAt)} ago` : null;
};

export const windowSpec = (
  label: string,
  icon: string,
  seen: PillWindow,
  now: number,
  tone: Tone,
  p: Palette,
  span: number = SPAN[label] ?? 0,
  key: string = label,
): PillSpec => {
  const w = rolled(seen, now, span);
  const at = w.resetsAt;
  const note = windowNote(w, now);
  const head: Seg[] = [
    { key: 'icon', text: ` ${icon} `, color: tone.fg },
    { key: 'label', text: `${label} `, color: p.tray.fg },
  ];
  const figure = `${note === null ? '' : '~'}${Math.round(w.percentUsed)}%`;
  const pct: Seg =
    note === null
      ? { key: 'pct', text: ` ${figure}`, color: 'text', bold: true }
      : { key: 'pct', text: ` ${figure}`, color: p.tray.fg };
  const aside: Seg[] = note === null ? [] : [{ key: 'note', text: ` · ${note}`, color: p.tray.fg }];
  const tail: Seg[] =
    at === null
      ? [{ key: 'end', text: ' ' }]
      : [
          { key: 'sep', text: ' │ ', color: p.tray.fg },
          { key: 'at', text: resetLabel(at, now), color: p.tray.fg },
          { key: 'end', text: ' ' },
        ];

  if (w.percentUsed >= LIMIT_AT) {
    const reached: Seg = { key: 'pct', text: ' limit reached', color: p.red.fg, bold: true };
    const row = [...head, reached, ...aside, ...tail];
    const tight = [
      ...head,
      { ...reached, text: '✕' },
      ...(at === null ? [] : [{ key: 'at', text: ` ${resetLabel(at, now)}`, color: p.tray.fg }]),
      { key: 'end', text: ' ' },
    ];

    return { key, tone: p.red, full: row, compact: row, tight };
  }

  return {
    key,
    tone,
    full: [...head, ...meter(key, w.percentUsed, note === null ? tone.fg : p.tray.fg, p), pct, ...aside, ...tail],
    compact: [...head, { ...pct, text: figure }, ...aside, ...tail],
    tight: [...head, { ...pct, text: `${figure} ` }],
  };
};

export const noLimitSpec = (label: string, icon: string, p: Palette): PillSpec => {
  const head: Seg[] = [
    { key: 'icon', text: ` ${icon} `, color: p.tray.fg },
    { key: 'label', text: `${label} `, color: p.tray.fg },
  ];
  const none: Seg = { key: 'none', text: '— no limit ', color: p.tray.fg };

  return { key: label, tone: p.tray, full: [...head, none], compact: [...head, none], tight: [...head, { ...none, text: '— ' }] };
};

export const extraSpec = (spend: ExtraSpend, p: Palette): PillSpec => {
  const reached = spend.percent !== null && spend.percent >= LIMIT_AT;
  const tone = reached ? p.red : p.gold;
  const icon: Seg = { key: 'icon', text: ` ${spend.symbol.trim()} `, color: tone.fg, bold: true };
  const amount: Seg = { key: 'extra-amount', text: `${spendRatio(spend)} `, color: 'text', bold: true };
  const bar: Seg[] = spend.percent === null ? [] : [...meter('extra', spend.percent, p.gold.fg, p), { key: 'gap', text: ' ' }];

  return {
    key: 'extra',
    tone,
    full: [icon, ...bar, amount],
    compact: [icon, amount],
    tight: [{ ...amount, text: ` ${spend.symbol}${spentText(spend)} ` }],
  };
};

export const prBadge = (pr: Pr, p: Palette): { state: Seg[]; checks: Seg[] } => {
  const word = (text: string, color: string): Seg[] => [{ key: 'pr-state', text: `${text} `, color }];
  const open: Record<Readiness, Seg[]> = {
    clean: word('● ready', p.green.fg),
    conflicts: word('✕ conflicts', p.red.fg),
    blocked: word('● blocked', p.gold.fg),
    failing: word('✕ checks', p.red.fg),
    behind: word('↓ behind', p.gold.fg),
    unknown: word('● open', p.green.fg),
  };
  const c0 = pr.checks;
  const running = pr.ready === 'failing' && c0 !== undefined && c0.failing === 0 && c0.pending > 0;
  const state = running
    ? word(`◷ ${c0?.pending ?? 0} running`, p.blue.fg)
    : pr.state === 'MERGED'
      ? word('✓ merged', p.purple.fg)
      : pr.state === 'CLOSED'
        ? word('✕ closed', p.red.fg)
        : pr.state === 'DRAFT'
          ? word('◌ draft', p.tray.fg)
          : open[pr.ready ?? 'unknown'];
  const c = pr.checks;
  const live = pr.state === 'OPEN' || pr.state === 'DRAFT';
  const checks: Seg[] =
    !live || !c || pr.ready === 'failing' || running
      ? []
      : c.failing > 0
        ? [{ key: 'pr-checks', text: `✕ ${c.failing} failing `, color: p.red.fg }]
        : c.pending > 0
          ? [{ key: 'pr-checks', text: `◷ ${c.pending} running `, color: p.blue.fg }]
          : [];

  return { state, checks };
};

const ICON = { worktree: '', repo: '', branch: '' };

type GitCount = 'ahead' | 'behind' | 'staged' | 'modified' | 'untracked' | 'conflicts';

export const gitSpec = (r: PillGit, p: Palette): PillSpec => {
  const marks: [GitCount, string, string][] = [
    ['ahead', `↑${r.ahead}`, 'text'],
    ['behind', `↓${r.behind}`, 'text'],
    ['staged', `+${r.staged}`, 'success'],
    ['modified', `~${r.modified}`, 'warning'],
    ['untracked', `?${r.untracked}`, p.tray.fg],
    ['conflicts', `!${r.conflicts}`, 'error'],
  ];
  const shown = marks.filter(([k]) => r[k] !== 0);
  const idle: Seg =
    r.isCheckedOut === false
      ? { key: 'clean', text: '◌ ', color: p.tray.fg }
      : r.isDirtyUncounted === true
        ? { key: 'dirty', text: '~ ', color: 'warning' }
        : { key: 'clean', text: '✓ ', color: 'success' };
  const status: Seg[] = [
    ...(r.pr ? [{ key: 'tree-sep', text: '│ ', color: p.tray.fg }] : []),
    ...(shown.length === 0 ? [idle] : shown.map(([k, text, color]) => ({ key: k, text: `${text} `, color }))),
  ];
  const branch: Seg[] = [
    { key: 'br-icon', text: `${ICON.branch} `, color: p.gold.fg, bold: true },
    { key: 'br', text: `${r.branch} `, color: 'text', bold: true },
  ];
  const prColor = { OPEN: 'success', DRAFT: p.tray.fg, MERGED: p.purple.fg, CLOSED: 'error' } as const;
  const pr: Seg[] = r.pr ? [{ key: 'pr', text: `#${r.pr.number} `, color: prColor[r.pr.state], bold: true }] : [];
  const badge = r.pr ? prBadge(r.pr, p) : { state: [], checks: [] };
  const base: Seg[] =
    r.base && r.base.behind > 0 ? [{ key: 'base', text: `↓${r.base.behind} ${r.base.name} `, color: p.gold.fg }] : [];
  const where: Seg[] = [
    { key: 'wt-icon', text: ` ${r.isLinked ? ICON.worktree : ICON.repo} `, color: p.tray.fg },
    { key: 'wt', text: r.worktree, color: 'text' },
    { key: 'wt-sep', text: ' │ ', color: p.tray.fg },
  ];
  const after = [...pr, ...badge.state, ...base, ...status];
  const cut = (lead: Seg[], cells: number): Seg[] | null => {
    const room = cells - segWidth(lead) - segWidth(branch.slice(0, 1)) - segWidth(after) - 1;
    if (room < MIN_BRANCH) return null;
    const name = [...r.branch];
    const visible = name.length <= room ? r.branch : `${name.slice(0, room - 1).join('')}…`;

    return [...lead, branch[0] as Seg, { ...(branch[1] as Seg), text: `${visible} ` }, ...after];
  };

  return {
    key: 'git',
    tone: p.tray,
    full: [...where, ...branch, ...pr, ...badge.state, ...badge.checks, ...base, ...status],
    compact: [...where, ...branch, ...after],
    tight: [{ key: 'pad', text: ' ' }, ...branch, ...after],
    fit: (cells) => cut(where, cells) ?? cut([{ key: 'pad', text: ' ' }], cells),
  };
};

export const folderSpec = (name: string, p: Palette): PillSpec => {
  const segs: Seg[] = [
    { key: 'wt-icon', text: ` ${ICON.repo} `, color: p.tray.fg },
    { key: 'wt', text: name, color: 'text' },
    { key: 'end', text: ' ' },
  ];
  return { key: 'folder', tone: p.tray, full: segs, compact: segs, tight: segs };
};

const sgr = (kind: 38 | 48, color: string): string => {
  const channels = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(color);
  return channels ? `\x1b[${kind};2;${channels[1]};${channels[2]};${channels[3]}m` : '';
};

const inkOf = (color: string | undefined, p: Palette): string =>
  color === undefined ? p.ink.text : color in p.ink ? p.ink[color as InkName] : color;

export const drawPill = (spec: PillSpec, segs: Seg[], p: Palette, caps: boolean): string => {
  const body = segs
    .map((seg) => `${seg.bold || BOLD_PILLS.has(spec.key) ? BOLD : NORMAL}${sgr(38, inkOf(seg.color, p))}${seg.text}`)
    .join('');
  const cap = (glyph: string): string => (caps ? `${sgr(38, spec.tone.bg)}${glyph}${RESET}` : '');

  return `${cap(CAP_LEFT)}${sgr(48, spec.tone.bg)}${body}${RESET}${cap(CAP_RIGHT)}`;
};

export interface PillOptions {
  palette: Palette;
  caps: boolean;
  now: number;
  maxRows?: number | null;
}

export const pillRows = (band: PillBand, columns: number, options: PillOptions): [PillSpec, Seg[]][][] => {
  const { palette: p, now } = options;
  const capWidth = options.caps ? 2 : 0;
  const pills: PillSpec[] = [
    contextSpec(band.context, band.model, p),
    ...(band.fiveHour
      ? [windowSpec('5h', '◷', band.fiveHour, now, p.green, p)]
      : band.noLimit?.fiveHour
        ? [noLimitSpec('5h', '◷', p)]
        : []),
    ...(band.sevenDay
      ? [windowSpec('7d', '▦', band.sevenDay, now, p.purple, p)]
      : band.noLimit?.sevenDay
        ? [noLimitSpec('7d', '▦', p)]
        : []),
    ...(band.scoped ?? [])
      .slice(0, MAX_SCOPED_PILLS)
      .map((scoped) =>
        windowSpec(`${scoped.label} 7d`, '▦', scoped.window, now, p.purple, p, SPAN['7d'] ?? 0, `7d-${scoped.label}`),
      ),
    ...(band.extra ? [extraSpec(band.extra, p)] : []),
    ...(band.git ? [gitSpec(band.git, p)] : band.folder ? [folderSpec(band.folder, p)] : []),
  ];
  const maxRows = options.maxRows ?? null;
  let rows = layout(pills, columns, capWidth);
  if (maxRows !== null && rows.length > maxRows) rows = layout(pills, columns, capWidth, true);
  for (const agent of band.agents) {
    rows.push(
      ...layout(
        [agentContextSpec(agent, band.model, band.context, p), ...(agent.git ? [gitSpec(agent.git, p)] : [])],
        columns,
        capWidth,
      ),
    );
  }

  return rows;
};

export const renderPillBand = (band: PillBand, columns: number, options: PillOptions): string[] =>
  pillRows(band, columns, options).map((row) =>
    row.map(([spec, segs]) => drawPill(spec, segs, options.palette, options.caps)).join(' '),
  );

const safe = (text: string): string => sanitizeDisplayText(text);

export const gitFromStatus = (status: GitStatus, fallbackName: string, snapshot: PrSnapshot | null | undefined): PillGit => {
  const stats = status.fileStats;
  const counts = {
    staged: stats?.staged ?? stats?.added ?? 0,
    modified: stats?.unstaged ?? (stats?.modified ?? 0) + (stats?.deleted ?? 0),
    untracked: stats?.untracked ?? 0,
    conflicts: stats?.conflicts ?? (status.conflict ? 1 : 0),
  };
  const own = snapshot?.own;
  const isCounted = counts.staged + counts.modified + counts.untracked + counts.conflicts > 0;

  return {
    worktree: safe(status.worktree ?? fallbackName),
    isLinked: status.isLinked === true,
    branch: safe(own?.branch ?? status.branch),
    ahead: own ? own.ahead : status.ahead,
    behind: own ? own.behind : status.behind,
    ...(own ? { staged: 0, modified: 0, untracked: 0, conflicts: 0, isCheckedOut: false } : counts),
    pr: snapshot?.pr ?? null,
    ...(snapshot?.base ? { base: { ...snapshot.base, name: safe(snapshot.base.name) } } : {}),
    ...(!own && status.isDirty && !isCounted ? { isDirtyUncounted: true } : {}),
  };
};

const folderName = (dir: string): string => formatProjectPath(dir, 1);

const agentFromSeen = (seen: SubagentSeen): PillAgent => ({
  type: safe(seen.type),
  model: safe(modelName(seen.model)),
  modelId: seen.modelId,
  effort: seen.effort === null ? null : safe(seen.effort),
  tokens: seen.tokens,
  ...(seen.window !== undefined ? { window: seen.window } : {}),
  ...(seen.git ? { git: gitFromStatus(seen.git, folderName(seen.worktree ?? ''), null) } : {}),
});

export const bandFromContext = (ctx: RenderContext): PillBand => {
  const display = ctx.config?.display;
  const size = ctx.stdin.context_window?.context_window_size;
  const context: PillContext | null =
    typeof size === 'number' && size > 0
      ? { tokens: getTotalTokens(ctx.stdin), window: size, percent: getContextPercent(ctx.stdin) }
      : null;
  const model: PillModel | null =
    display?.showModel === false
      ? null
      : {
          name: safe(
            modelName(
              formatModelName(
                resolveModelName(ctx.stdin, ctx.transcript, display?.modelSource),
                'short',
                display?.modelOverride,
              ),
            ),
          ),
          effort: ctx.effortLevel ? safe(ctx.effortLevel) : null,
        };
  const usage = shouldHideUsage(ctx.stdin) ? null : ctx.usageData;
  const window = (
    percent: number | null | undefined,
    resetAt: Date | null | undefined,
    seenAt?: Date | null,
    isRolled?: boolean,
  ): PillWindow | null =>
    typeof percent === 'number'
      ? {
          percentUsed: percent,
          resetsAt: resetAt?.getTime() ?? null,
          ...(seenAt !== undefined && { seenAt: seenAt === null ? null : seenAt.getTime() }),
          ...(isRolled && { isRolled: true }),
        }
      : null;
  const scoped: PillScoped[] = (usage?.scopedWindows ?? []).flatMap((w) => {
    const pill = window(w.percent, w.resetAt);
    return pill ? [{ label: safe(w.label), window: pill }] : [];
  });
  const cwd = ctx.stdin.cwd;
  const folder = cwd && display?.showProject !== false ? folderName(cwd) : null;

  return {
    context,
    model,
    fiveHour: window(usage?.fiveHour, usage?.fiveHourResetAt, usage?.fiveHourSeenAt, usage?.fiveHourRolled),
    sevenDay: window(usage?.sevenDay, usage?.sevenDayResetAt, usage?.sevenDaySeenAt, usage?.sevenDayRolled),
    noLimit: { fiveHour: usage?.fiveHourUnlimited === true, sevenDay: usage?.sevenDayUnlimited === true },
    scoped,
    extra: extraSpend(usage),
    git: ctx.gitStatus ? gitFromStatus(ctx.gitStatus, folder ?? '', ctx.prStatus) : null,
    folder,
    agents: (ctx.pillAgents ?? []).map(agentFromSeen),
  };
};

export const renderPillLines = (ctx: RenderContext, columns: number | null, now: number = Date.now()): string[] => {
  const display = ctx.config?.display;
  const mode = display?.pillTheme ?? 'auto';

  return renderPillBand(bandFromContext(ctx), columns !== null && columns > 0 ? columns : Number.POSITIVE_INFINITY, {
    palette: paletteFor(mode === 'auto' ? ctx.claudeTheme : mode),
    caps: display?.pillCaps !== false,
    now,
    maxRows: display?.pillMaxRows ?? null,
  });
};
