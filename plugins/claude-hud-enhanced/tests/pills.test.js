import './helpers/isolate-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { render } from '../dist/render/index.js';
import { DEFAULT_CONFIG, mergeConfig } from '../dist/config.js';
import {
  agentContextSpec,
  agentWindow,
  extraSpec,
  bandFromContext,
  clip,
  compact,
  contextSpec,
  drawPill,
  gitFromStatus,
  gitSpec,
  layout,
  modelName,
  usageSpecs,
  paletteFor,
  pillRows,
  prBadge,
  renderPillBand,
  resetLabel,
  rolled,
  scopedSpec,
  windowNote,
  windowSpec,
} from '../dist/render/pills.js';
import {
  parseChecks,
  parseLeftRight,
  parsePr,
  parsePull,
  parseRemote,
  pickPr,
  prFromCommand,
  prFromResult,
  prFromTitle,
  requestKey,
  resolvePrStatus,
  splitHttp,
} from '../dist/pr-status.js';
import { emptyState, refreshPr } from '../dist/refresh-pr.js';
import { currencySymbol, extraSpend, extraSpendLabel, formatAmount, formatLimit, minorToAmount, spendRatio } from '../dist/extra-usage.js';
import { knownWindows, learnWindows, parseAgentFeed, parseAgentTail, readRunningSubagents, seedKnownWindows } from '../dist/subagents.js';
import { parseTranscript } from '../dist/transcript.js';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const FIVE_RESET = NOW + 160 * 60_000;
const SEVEN_RESET = NOW + 31 * 3_600_000;
const DARK = paletteFor('dark');

const GIT = {
  worktree: 'Thesis',
  isLinked: false,
  branch: 'main',
  ahead: 3,
  behind: 0,
  staged: 1,
  modified: 1,
  untracked: 2,
  conflicts: 0,
  pr: null,
};

const band = (overrides = {}) => ({
  context: { tokens: 68_000, window: 200_000, percent: 34 },
  model: { name: 'Opus 5.5', effort: 'medium' },
  fiveHour: { percentUsed: 20, resetsAt: FIVE_RESET },
  sevenDay: { percentUsed: 58, resetsAt: SEVEN_RESET },
  git: GIT,
  folder: 'Thesis',
  agents: [],
  ...overrides,
});

const options = (overrides = {}) => ({ palette: DARK, caps: true, now: NOW, ...overrides });
const texts = (rows) => rows.flatMap((row) => row.flatMap(([, segs]) => segs.map((seg) => seg.text)));
const rowKeys = (rows) => rows.map((row) => row.map(([spec]) => spec.key));

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function withColumns(columns, fn) {
  const original = process.stdout.columns;
  const env = process.env.COLUMNS;
  delete process.env.COLUMNS;
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.stdout.columns;
    else Object.defineProperty(process.stdout, 'columns', { value: original, configurable: true });
    if (env !== undefined) process.env.COLUMNS = env;
  }
}

function context(overrides = {}) {
  return {
    stdin: {
      model: { id: 'claude-opus-5-5[1m]', display_name: 'Opus 5.5 (1M context)' },
      cwd: '/x/Thesis',
      context_window: {
        context_window_size: 1_000_000,
        used_percentage: 7,
        current_usage: { input_tokens: 2, cache_creation_input_tokens: 330, cache_read_input_tokens: 68_668 },
      },
    },
    transcript: { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    gitStatus: {
      branch: 'main',
      isDirty: true,
      ahead: 0,
      behind: 0,
      worktree: 'Thesis',
      isLinked: false,
      fileStats: { modified: 6, added: 0, deleted: 0, untracked: 3, staged: 0, unstaged: 6, conflicts: 0, trackedFiles: [] },
    },
    usageData: {
      fiveHour: 42,
      sevenDay: 8,
      fiveHourResetAt: new Date(Date.now() + 130 * 60_000),
      sevenDayResetAt: new Date(Date.now() + 4 * 24 * 3_600_000),
    },
    memoryUsage: null,
    config: mergeConfig({ lineLayout: 'pills', display: { pillCaps: true } }),
    extraLabel: null,
    effortLevel: 'medium',
    ...overrides,
  };
}

function capture(ctx, columns) {
  const lines = [];
  withColumns(columns, () => render(ctx, (line) => lines.push(line)));
  return lines;
}

test('the band shows context, both windows, reset times and git', () => {
  const expected = [
    ' Opus 5.5 ',
    'medium ',
    ' ◔ ',
    ' 20%',
    resetLabel(FIVE_RESET, NOW),
    ' 58%',
    resetLabel(SEVEN_RESET, NOW),
    'Thesis',
    'main ',
    '↑3 ',
    '+1 ',
    '~1 ',
    '?2 ',
    ' 34%',
    ' 68.0k/200.0k ',
  ];
  for (const caps of [true, false]) {
    const rows = pillRows(band(), 200, options({ caps }));
    const found = texts(rows);
    assert.deepEqual(rowKeys(rows), [['context', '5h', '7d', 'git']]);
    for (const text of expected) assert.ok(found.includes(text), `missing ${JSON.stringify(text)}`);
    assert.ok(!found.some((text) => /\$|↓ \d|≋|↻/.test(text)));
    assert.ok(found.includes('━╸'));
    assert.ok(found.includes('━━━━━━'));
    assert.ok(found.includes('━━━━╸'));
    assert.ok(found.includes('━━━'));
  }
});

test('the row reads as four pills in order with the mod glyphs', () => {
  const [row] = renderPillBand(band(), 200, options()).map(stripAnsi);
  assert.equal(
    row,
    ` Opus 5.5 medium │ ◔ ━━╸━━━━━ 34% 68.0k/200.0k  `
      + ` ◷ 5h ━╸━━━━━━ 20% │ ${resetLabel(FIVE_RESET, NOW)}  `
      + ` ▦ 7d ━━━━╸━━━ 58% │ ${resetLabel(SEVEN_RESET, NOW)}  `
      + `  Thesis │  main ↑3 +1 ~1 ?2 `,
  );
});

test('reset times read as a clock time today and a weekday later', () => {
  const now = new Date(2026, 9, 4, 12, 0).getTime();
  assert.equal(resetLabel(new Date(2026, 9, 4, 14, 40).getTime(), now), '2:40 PM');
  assert.equal(resetLabel(new Date(2026, 9, 4, 12, 0).getTime(), now), '12:00 PM');
  assert.equal(resetLabel(new Date(2026, 9, 6, 0, 30).getTime(), now), 'Tue 12:30 AM');
  assert.equal(resetLabel(new Date(2026, 9, 6, 9, 5).getTime(), now), 'Tue 9:05 AM');
});

test('light themes get the light pastels and every other theme the dark ones', () => {
  assert.equal(paletteFor('light').green.bg, 'rgb(221,236,226)');
  assert.equal(paletteFor('light-ansi').green.bg, 'rgb(221,236,226)');
  assert.equal(paletteFor('dark-ansi').green.bg, 'rgb(36,58,44)');
  assert.equal(paletteFor('auto').green.bg, 'rgb(36,58,44)');
  assert.equal(paletteFor('custom:orca').green.bg, 'rgb(36,58,44)');
  assert.equal(paletteFor(null).green.bg, 'rgb(36,58,44)');
});

test('the model pill has a tone of its own in both palettes, as readable as the others', () => {
  assert.deepEqual(paletteFor('light').teal, { bg: 'rgb(214,236,241)', fg: 'rgb(26,124,138)' });
  assert.deepEqual(paletteFor('dark').teal, { bg: 'rgb(28,56,66)', fg: 'rgb(108,204,216)' });
  const channels = (rgb) => rgb.match(/\d+/g).map(Number);
  const luminance = (rgb) => {
    const [r, g, b] = channels(rgb).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (tone) => {
    const [hi, lo] = [luminance(tone.bg), luminance(tone.fg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  };
  const apart = (a, b) => Math.max(...channels(a).map((v, i) => Math.abs(v - channels(b)[i])));
  const sgr = (layer, rgb) => `\x1b[${layer};2;${channels(rgb).join(';')}m`;
  const at = SEVEN_RESET;
  for (const theme of ['light', 'dark']) {
    const p = paletteFor(theme);
    const others = [p.green, p.purple, p.blue, p.gold, p.red];
    const ratios = others.map(contrast);
    assert.ok(contrast(p.teal) >= Math.min(...ratios) && contrast(p.teal) <= Math.max(...ratios), `${theme}: contrast ${contrast(p.teal)}`);
    for (const other of [...others, p.mint, p.tray]) {
      assert.ok(apart(p.teal.fg, other.fg) >= 40, `${theme}: ink apart from ${other.fg}`);
      assert.ok(apart(p.teal.bg, other.bg) >= 8, `${theme}: fill apart from ${other.bg}`);
    }
    const spec = (percentUsed) => scopedSpec({ label: 'Fable', window: { percentUsed, resetsAt: at } }, null, NOW, p);
    const calm = spec(43);
    assert.equal(calm.tone, p.teal);
    assert.equal(calm.full.find((seg) => seg.key === 'icon').color, p.teal.fg);
    assert.equal(calm.full.find((seg) => seg.key === '7d-Fable-fill').color, p.teal.fg);
    assert.equal(spec(75).full.find((seg) => seg.key === '7d-Fable-fill').color, p.gold.fg);
    assert.equal(spec(90).full.find((seg) => seg.key === '7d-Fable-fill').color, p.red.fg);
    assert.equal(spec(100).tone, p.red);
    const drawn = drawPill(calm, calm.full, p, true);
    assert.ok(drawn.includes(sgr(48, p.teal.bg)), `${theme}: the pill is filled with its own tone`);
    assert.ok(drawn.includes(`${sgr(38, p.teal.fg)}━━━╸`), `${theme}: the bar is drawn in its own ink`);
    const row = renderPillBand(band({ scoped: [{ label: 'Fable', window: { percentUsed: 43, resetsAt: at } }] }), 600, options({ palette: p }))[0];
    assert.ok(row.includes(sgr(48, p.teal.bg)) && row.includes(sgr(48, p.purple.bg)) && row.includes(sgr(48, p.green.bg)), `${theme}: 5h, model and 7d each have their own fill`);
  }
});

test('model ids read as their family and version', () => {
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelName('claude-fable-5-1[1m]'), 'Fable 5.1');
  assert.equal(modelName('Opus 5.5'), 'Opus 5.5');
  assert.equal(compact(999), '999');
  assert.equal(compact(69_000), '69.0k');
  assert.equal(compact(1_000_000), '1.0M');
});

test('a narrow band drops the bars and packs pills into rows that fit', () => {
  const rows = pillRows(band(), 38, options());
  const found = texts(rows);
  assert.ok(!found.some((text) => text.startsWith('━')));
  assert.ok(!found.some((text) => text.includes('68.0k')));
  const shown = found.map((text) => text.trim());
  for (const text of ['34%', '20%', '58%', 'main']) assert.ok(shown.includes(text), `missing ${text}`);
  assert.ok(rows.length > 1);
});

const pill = (key, n) => ({
  key,
  tone: { bg: 'x', fg: 'y' },
  full: [{ key: 'a', text: 'x'.repeat(n * 2) }],
  compact: [{ key: 'a', text: 'x'.repeat(n) }],
  tight: [{ key: 'a', text: 'x'.repeat(n) }],
});
const segText = (rows) => rows[0]?.[0]?.[1][0]?.text.length;

test('layout fills one row when it fits and wraps whole pills when not', () => {
  const four = ['a', 'b', 'c', 'd'].map((k) => pill(k, 10));
  assert.deepEqual(layout(four, 100, 2).map((r) => r.length), [4]);
  assert.equal(segText(layout(four, 100, 2)), 20);
  assert.deepEqual(layout(four, 60, 2).map((r) => r.length), [4]);
  assert.equal(segText(layout(four, 60, 2)), 10);
  assert.deepEqual(layout(four, 30, 2).map((r) => r.length), [2, 2]);
  const mixed = [pill('a', 10), pill('b', 4), pill('c', 6), pill('d', 8)];
  const packed = layout(mixed, 26, 2);
  assert.deepEqual(rowKeys(packed), [['a', 'b'], ['c', 'd']], 'each row takes as many whole pills as fit, in order');
  assert.ok(packed.flat().every(([, segs]) => segs.every((seg) => seg.key !== 'pad')), 'no pill is padded out to a column');
  assert.deepEqual(rowKeys(layout([pill('a', 20), pill('b', 3), pill('c', 3), pill('d', 20)], 26, 2)), [['a'], ['b', 'c'], ['d']], 'a wide pill does not force its short neighbours onto rows of their own');
  const four6 = ['context', '5h', '7d', 'git'].map((k) => pill(k, 6));
  assert.deepEqual(rowKeys(layout(four6, 20, 2)), [
    ['context', '5h'],
    ['7d', 'git'],
  ]);
  const sizes = (key, small, tight) => ({ key, tone: { bg: 'x', fg: 'y' }, full: [{ key: 'a', text: 'x'.repeat(40) }], compact: [{ key: 'a', text: 'x'.repeat(small) }], tight: [{ key: 'a', text: 'x'.repeat(tight) }] });
  const dense = layout([sizes('a', 20, 8), sizes('b', 20, 8), sizes('c', 20, 8)], 34, 2);
  assert.deepEqual(rowKeys(dense), [['a', 'b', 'c']], 'the tight form is used when it saves a row');
  assert.deepEqual(dense[0].map(([, segs]) => segs[0].text.length), [8, 8, 8]);
  const flowed = layout([sizes('a', 20, 8), sizes('b', 20, 8), sizes('c', 30, 8)], 28, 2);
  assert.deepEqual(flowed.map((r) => r.map(([, segs]) => segs[0].text.length)), [[20], [20], [8]], 'past one row each pill is compact, tight only when compact cannot fit');
  const clipped = layout([sizes('a', 40, 30)], 12, 2);
  assert.equal(clipped[0][0][1].map((seg) => seg.text).join(''), `${'x'.repeat(9)}…`, 'a pill wider than the pane is cut to it');
});

test('a narrow band puts the whole branch on a row of its own', () => {
  const wide = (key, n) => ({
    key,
    tone: { bg: 'x', fg: 'y' },
    full: [{ key: 'a', text: 'x'.repeat(n * 3) }],
    compact: [{ key: 'a', text: 'x'.repeat(n * 2) }],
    tight: [{ key: 'a', text: 'x'.repeat(n) }],
  });
  const branch = 'fix/no-cleartext-any-build';
  const git = {
    ...wide('git', 0),
    full: [{ key: 'br', text: branch }],
    compact: [{ key: 'br', text: branch }],
    tight: [{ key: 'br', text: branch }],
    fit: (cells) => (cells < 8 ? null : [{ key: 'br', text: branch.slice(0, cells) }]),
  };
  const others = [wide('context', 10), wide('5h', 10), wide('7d', 10)];
  const rows = layout([...others, git], 40, 2);
  assert.deepEqual(rowKeys(rows), [['context', '5h', '7d'], ['git']]);
  assert.equal(rows[1]?.[0]?.[1][0]?.text, branch);
  const narrow = layout([wide('context', 3), git], 20, 2);
  assert.equal(narrow[1]?.[0]?.[1][0]?.text, branch.slice(0, 18));
});

test('the full pills keep their bars with git moved to a row of its own', () => {
  const sized = (key, full, small, fit = false) => ({
    key,
    tone: { bg: 'x', fg: 'y' },
    full: [{ key: 'a', text: 'x'.repeat(full) }],
    compact: [{ key: 'a', text: 'x'.repeat(small) }],
    tight: [{ key: 'a', text: 'x'.repeat(small) }],
    ...(fit ? { fit: () => null } : {}),
  });
  const rows = layout(
    [sized('context', 28, 10), sized('5h', 28, 10), sized('7d', 28, 10), sized('git', 38, 20, true)],
    110,
    2,
  );
  assert.deepEqual(
    rows.map((r) => r.map(([x, segs]) => `${x.key}:${segs[0]?.text.length}`)),
    [['context:28', '5h:28', '7d:28'], ['git:38']],
  );
});

test('with a row limit the pills share one row instead of wrapping', () => {
  const wrapped = pillRows(band(), 88, options());
  assert.deepEqual(rowKeys(wrapped), [['context', '5h', '7d'], ['git']]);
  const limited = pillRows(band(), 88, options({ maxRows: 1 }));
  assert.deepEqual(rowKeys(limited), [['context', '5h', '7d', 'git']]);
  const shown = texts(limited).map((text) => text.trim());
  for (const text of ['34%', '20%', '58%', 'main']) assert.ok(shown.includes(text), text);
  assert.deepEqual(rowKeys(pillRows(band(), 88, options({ maxRows: 2 }))), rowKeys(wrapped));
  assert.deepEqual(rowKeys(pillRows(band(), 400, options({ maxRows: 1 }))), [['context', '5h', '7d', 'git']]);
  const sized = (key, full, small, tight) => ({
    key,
    tone: { bg: 'x', fg: 'y' },
    full: [{ key: 'a', text: 'x'.repeat(full) }],
    compact: [{ key: 'a', text: 'x'.repeat(small) }],
    tight: [{ key: 'a', text: 'x'.repeat(tight) }],
  });
  const pills = [sized('context', 30, 20, 8), sized('5h', 30, 20, 8), sized('7d', 30, 20, 8)];
  assert.deepEqual(layout(pills, 70, 2, true).map((r) => r.map(([, segs]) => segs[0].text.length)), [[20, 20, 20]]);
  assert.deepEqual(layout(pills, 40, 2, true).map((r) => r.map(([, segs]) => segs[0].text.length)), [[8, 8, 8]]);
  assert.ok(layout(pills, 20, 2, true).length > 1, 'too narrow for one row: the usual wrapping still applies');
  assert.equal(mergeConfig({ display: { pillMaxRows: 1 } }).display.pillMaxRows, 1);
  for (const bad of [0, -1, 1.5, '2', null]) assert.equal(mergeConfig({ display: { pillMaxRows: bad } }).display.pillMaxRows, null);
});

test('a window whose reset time has passed reads 0% and rolls its reset forward', () => {
  const span = 5 * 3_600_000;
  const w = { percentUsed: 96, resetsAt: NOW };
  assert.deepEqual(rolled(w, NOW + 1, span), { percentUsed: 0, resetsAt: NOW + span, isRolled: true });
  assert.equal(rolled(w, NOW + 2 * span + 1, span).resetsAt, NOW + 3 * span);
  assert.deepEqual(rolled(w, NOW - 1, span), w);
  const found = texts(pillRows(band({ fiveHour: { percentUsed: 96, resetsAt: NOW - 1 } }), 200, options()));
  assert.ok(found.includes(' ~0%'));
  assert.ok(found.includes(' · reset'));
  assert.ok(found.includes(resetLabel(NOW - 1 + span, NOW)));
});

test('the 5h pill is never hidden for age: a passed reset rolls it to 0% instead', () => {
  const span = 5 * 3_600_000;
  const old = { percentUsed: 80, resetsAt: NOW - 3 * span };
  const rows = pillRows(band({ fiveHour: old }), 400, options());
  assert.deepEqual(rowKeys(rows), [['context', '5h', '7d', 'git']]);
  assert.ok(texts(rows).includes(' ~0%'));
  assert.ok(texts(rows).includes(' · reset'));
  assert.ok(!texts(rows).some((part) => part.includes('80%')));
  const ctx = context({ usageData: { fiveHour: 12, sevenDay: 8, fiveHourResetAt: new Date(Date.now() + 60_000), sevenDayResetAt: null, staleSince: new Date(Date.now() - 9 * span) } });
  assert.ok(bandFromContext(ctx).fiveHour, 'a reading the poll could not confirm is still shown');
  assert.equal(bandFromContext(context({ usageData: { fiveHour: null, sevenDay: 8, fiveHourResetAt: null, sevenDayResetAt: null } })).fiveHour, null);
});

test('a reached limit turns the pill red and says so, with a cross when tight', () => {
  const spec = windowSpec('5h', '◷', { percentUsed: 100, resetsAt: FIVE_RESET }, NOW, DARK.green, DARK);
  assert.equal(spec.tone, DARK.red);
  assert.equal(spec.full.map((s) => s.text).join(''), ` ◷ 5h  limit reached │ ${resetLabel(FIVE_RESET, NOW)} `);
  assert.equal(spec.tight.map((s) => s.text).join(''), ` ◷ 5h ✕ ${resetLabel(FIVE_RESET, NOW)} `);
  const calm = windowSpec('7d', '▦', { percentUsed: 58, resetsAt: null }, NOW, DARK.purple, DARK);
  assert.equal(calm.tone, DARK.purple);
  assert.equal(calm.full.map((s) => s.text).join(''), ' ▦ 7d ━━━━╸━━━ 58% ');
});

test('the bar turns gold at 75% and red at 90%', () => {
  const fill = (percent) =>
    windowSpec('5h', '◷', { percentUsed: percent, resetsAt: null }, NOW, DARK.green, DARK).full.find(
      (s) => s.key === '5h-fill',
    );
  assert.equal(fill(74).color, DARK.green.fg);
  assert.equal(fill(75).color, DARK.gold.fg);
  assert.equal(fill(90).color, DARK.red.fg);
  assert.equal(fill(4).text, '╸');
  assert.equal(fill(0).text, '');
});

test('the context pill reads a dash without a figure and drops the lead without a model', () => {
  const none = contextSpec(null, { name: 'Opus 5.5', effort: null }, DARK);
  assert.equal(none.full.map((s) => s.text).join(''), ' Opus 5.5 │ ◔ — ');
  assert.equal(contextSpec(null, null, DARK).full.map((s) => s.text).join(''), ' ◔ — ');
  const some = contextSpec({ tokens: 69_000, window: 1_000_000, percent: 7 }, { name: 'Opus 5.5', effort: 'medium' }, DARK);
  assert.equal(some.full.map((s) => s.text).join(''), ' Opus 5.5 medium │ ◔ ╸━━━━━━━ 7% 69.0k/1.0M ');
  assert.equal(some.compact.map((s) => s.text).join(''), ' Opus 5.5 medium │ ◔ 7% ');
  assert.equal(some.tight.map((s) => s.text).join(''), ' Opus 5.5 medium ◔ 7% ');
});

test('the git pill shows the worktree, branch and each count in the mod format', () => {
  const text = (git) => gitSpec(git, DARK, true).full.map((s) => s.text).join('');
  assert.equal(text({ ...GIT, ahead: 0, staged: 0, modified: 6, untracked: 3 }), '  Thesis │  main ~6 ?3 ');
  assert.equal(text({ ...GIT, ahead: 0, staged: 0, modified: 0, untracked: 0 }), '  Thesis │  main ✓ ');
  assert.equal(
    text({ ...GIT, isLinked: true, worktree: 'wt-a', behind: 2, conflicts: 1 }),
    '  wt-a │  main ↑3 ↓2 +1 ~1 ?2 !1 ',
  );
  const marks = gitSpec({ ...GIT, conflicts: 1 }, DARK).full;
  const color = (key) => marks.find((s) => s.key === key)?.color;
  assert.equal(color('staged'), 'success');
  assert.equal(color('modified'), 'warning');
  assert.equal(color('untracked'), DARK.tray.fg);
  assert.equal(color('conflicts'), 'error');
  assert.equal(color('br-icon'), DARK.gold.fg);
});

test('a narrow band keeps the worktree name and cuts the branch instead', () => {
  const git = { ...GIT, worktree: 'pre-inspection-march', isLinked: true, branch: 'feat/pre-inspection-march', ahead: 0, staged: 0, modified: 0, untracked: 0 };
  const rows = pillRows(band({ context: null, model: null, fiveHour: null, sevenDay: null, git }), 48, options());
  const found = texts(rows);
  assert.ok(found.includes('pre-inspection-march'));
  assert.ok(found.some((text) => /^feat\/pre-insp.*…/.test(text)));
});

test('every row fits the pane at each width and nothing is lost when wide', () => {
  const visible = (line) => [...stripAnsi(line)].length;
  for (const columns of [200, 160, 120, 110, 100, 80, 60, 50, 40, 30, 20, 12]) {
    const lines = renderPillBand(band(), columns, options());
    assert.ok(lines.length > 0);
    for (const line of lines) assert.ok(visible(line) <= columns, `${columns}: ${visible(line)} ${stripAnsi(line)}`);
  }
  assert.equal(renderPillBand(band(), 200, options()).length, 1);
  assert.deepEqual(rowKeys(pillRows(band(), 130, options())), [['context', '5h', '7d'], ['git']]);
  assert.ok(texts(pillRows(band(), 130, options())).includes('━━━━╸'));
  assert.deepEqual(rowKeys(pillRows(band(), 30, options())), [['context'], ['5h'], ['7d'], ['git']]);
});

test('gh pr view output parses into the PR number and its state', () => {
  assert.deepEqual(parsePr('{"number":123,"state":"OPEN","isDraft":false}'), { number: 123, state: 'OPEN' });
  assert.deepEqual(parsePr('{"number":7,"state":"OPEN","isDraft":true}'), { number: 7, state: 'DRAFT' });
  assert.deepEqual(parsePr('{"number":9,"state":"MERGED","isDraft":false}'), { number: 9, state: 'MERGED' });
  assert.deepEqual(parsePr('{"number":4,"state":"CLOSED"}'), { number: 4, state: 'CLOSED' });
  assert.equal(parsePr('no pull requests found for branch "x"'), null);
  assert.equal(parsePr('{}'), null);
});

test('the session PR comes from gh pr output or the engine git classification, last owned one wins', () => {
  const url = 'https://github.com/acme/app/pull/1200';
  assert.deepEqual(prFromCommand('gh pr create --fill', `Creating pull request\n${url}\n`), { number: 1200, url, owned: true });
  assert.equal(prFromCommand('git push', url), null);
  assert.deepEqual(prFromResult({ gitOperation: { pr: { number: 7, action: 'created' } } }), { number: 7, url: '', owned: true });
  const viewed = prFromCommand('gh pr view https://github.com/acme/app/pull/1191', 'merged');
  const created = prFromCommand('gh pr create --fill', url);
  assert.equal(pickPr(pickPr(null, viewed), created)?.number, 1200);
  assert.equal(pickPr(pickPr(null, created), viewed)?.number, 1200);
  assert.equal(pickPr(null, null), null);
  assert.equal(prFromTitle('1037-chargingstations-rating'), 1037);
  assert.equal(prFromTitle('pre-inspection-march-1159'), 1159);
  assert.equal(prFromTitle('fix the 12 bugs'), null);
});

test('gh api output, the pull and its check runs parse into the PR state', () => {
  const http = 'HTTP/2.0 200 OK\nAccess-Control-Allow-Origin: *\r\nEtag: W/"abc"\r\n\r\n{"number":1040}';
  assert.deepEqual(splitHttp(http), { status: 200, etag: 'W/"abc"', body: '{"number":1040}' });
  assert.equal(splitHttp('HTTP/2.0 304 Not Modified\nEtag: W/"abc"\r\n\r\n').status, 304);
  const pull = (o) => parsePull(JSON.stringify({ number: 1040, head: { ref: 'feat/x', sha: 's1' }, ...o }));
  assert.equal(pull({ state: 'closed', merged: true })?.state, 'MERGED');
  assert.equal(pull({ state: 'closed', merged: false })?.state, 'CLOSED');
  assert.equal(pull({ state: 'open', draft: true })?.state, 'DRAFT');
  const dirty = pull({ state: 'open', mergeable_state: 'dirty' });
  assert.deepEqual(
    { state: dirty.state, ready: dirty.ready, branch: dirty.branch, sha: dirty.sha },
    { state: 'OPEN', ready: 'conflicts', branch: 'feat/x', sha: 's1' },
  );
  assert.equal(pull({ state: 'open', mergeable_state: 'clean' })?.ready, 'clean');
  assert.equal(pull({ state: 'open', mergeable_state: 'unknown' })?.ready, 'unknown');
  const runs = {
    check_runs: [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
      { status: 'in_progress', conclusion: null },
      { status: 'completed', conclusion: 'skipped' },
    ],
  };
  assert.deepEqual(parseChecks(JSON.stringify(runs)), { failing: 1, pending: 1, passing: 2 });
  assert.equal(parseRemote('https://github.com/Acme/App.git\n'), 'acme/app');
  assert.equal(parseRemote('git@github.com:acme/app.git'), 'acme/app');
  assert.equal(parseRemote('https://gitlab.com/acme/app.git'), '');
  assert.deepEqual(parseLeftRight('17\t2\n'), { behind: 17, ahead: 2 });
  assert.equal(parseLeftRight('fatal'), null);
});

test('the badge says merged, closed, draft or whether an open PR can merge', () => {
  const text = (b) => [...b.state, ...b.checks].map((x) => x.text).join('');
  assert.equal(text(prBadge({ number: 1, state: 'MERGED' }, DARK)), '✓ merged ');
  assert.equal(text(prBadge({ number: 1, state: 'CLOSED' }, DARK)), '✕ closed ');
  assert.equal(text(prBadge({ number: 1, state: 'OPEN', ready: 'conflicts' }, DARK)), '✕ conflicts ');
  assert.equal(
    text(prBadge({ number: 1, state: 'OPEN', ready: 'clean', checks: { failing: 0, pending: 0, passing: 3 } }, DARK)),
    '● ready ',
  );
  assert.equal(
    text(prBadge({ number: 1, state: 'OPEN', ready: 'blocked', checks: { failing: 0, pending: 2, passing: 1 } }, DARK)),
    '● blocked ◷ 2 running ',
  );
  assert.equal(
    text(prBadge({ number: 1, state: 'DRAFT', checks: { failing: 1, pending: 0, passing: 0 } }, DARK)),
    '◌ draft ✕ 1 failing ',
  );
  assert.equal(
    text(prBadge({ number: 1, state: 'OPEN', ready: 'failing', checks: { failing: 0, pending: 3, passing: 3 } }, DARK)),
    '◷ 3 running ',
  );
  assert.equal(
    text(prBadge({ number: 1, state: 'OPEN', ready: 'failing', checks: { failing: 1, pending: 2, passing: 3 } }, DARK)),
    '✕ checks ',
  );
});

test('the git pill carries the PR number, its state, the base and the tree status', () => {
  const pr = { number: 1040, state: 'OPEN', ready: 'blocked', base: 'main', checks: { failing: 0, pending: 2, passing: 1 } };
  const spec = gitSpec({ ...GIT, ahead: 0, staged: 0, modified: 0, untracked: 0, pr, base: { name: 'main', behind: 17, ahead: 2 } }, DARK, true);
  assert.equal(
    spec.full.map((s) => s.text).join(''),
    '  Thesis │  main #1040 ● blocked ◷ 2 running ↓17 main │ ✓ ',
  );
  assert.equal(spec.compact.map((s) => s.text).join(''), '  Thesis │  main #1040 ● blocked ↓17 main │ ✓ ');
  assert.equal(spec.tight.map((s) => s.text).join(''), '  main #1040 ● blocked ↓17 main │ ✓ ');
  const other = gitSpec({ ...GIT, ahead: 2, staged: 0, modified: 0, untracked: 0, pr, isCheckedOut: false }, DARK);
  assert.ok(other.full.map((s) => s.text).join('').endsWith('│ ↑2 '));
  const idle = gitSpec({ ...GIT, ahead: 0, staged: 0, modified: 0, untracked: 0, pr, isCheckedOut: false }, DARK);
  assert.ok(idle.full.map((s) => s.text).join('').endsWith('│ ◌ '));
});

const out = (stdout, exitCode = 0, stderr = '') => ({ exitCode, stdout, stderr });

test('the PR status comes live from GitHub and a 304 reuses the last answer', async () => {
  let state = 'open';
  const sent = [];
  const run = async (argv) => {
    const [cmd, sub] = argv;
    if (cmd === 'gh' && sub === 'pr') return out('{"number":1040,"state":"OPEN","isDraft":false,"headRefName":"feat/x"}');
    if (cmd === 'gh' && sub === 'api') {
      sent.push([...argv]);
      const apiPath = argv[2] ?? '';
      const conditional = argv.includes('-H');
      if (apiPath.includes('/pulls/')) {
        if (conditional && state === 'open') return out('HTTP/2.0 304 Not Modified\nEtag: W/"p1"\r\n\r\n', 1, 'gh: HTTP 304');
        const body = { number: 1040, state, merged: state === 'closed', mergeable_state: 'dirty', head: { ref: 'feat/x', sha: 's1' } };
        return out(`HTTP/2.0 200 OK\nEtag: W/"${state === 'open' ? 'p1' : 'p2'}"\r\n\r\n${JSON.stringify(body)}`);
      }
      return out('HTTP/2.0 200 OK\nEtag: W/"c1"\r\n\r\n{"check_runs":[]}');
    }
    return out('', 1);
  };
  const req = { cwd: '/x/acme-app', session: 's', branch: 'feat/x', named: null, sessionPr: null };
  const memory = emptyState();
  const deps = { run, now: () => NOW };
  const badge = (snapshot) => prBadge(snapshot.pr, DARK).state.map((s) => s.text).join('');
  let { snapshot } = await refreshPr(req, memory, deps);
  assert.equal(snapshot.request, requestKey(req));
  assert.equal(badge(snapshot), '✕ conflicts ');
  ({ snapshot } = await refreshPr(req, memory, deps));
  assert.ok(sent.some((a) => a.includes('If-None-Match: W/"p1"')));
  assert.equal(badge(snapshot), '✕ conflicts ');
  state = 'closed';
  ({ snapshot } = await refreshPr(req, memory, deps));
  assert.equal(badge(snapshot), '✓ merged ');
});

test('a session working on its own PR shows that PR branch, not the shared checkout', async () => {
  const run = async (argv) => {
    const [cmd, sub] = argv;
    if (cmd === 'git' && sub === 'for-each-ref') return out('[ahead 2]\n');
    if (cmd === 'gh' && sub === 'pr') {
      return out('{"number":1040,"state":"OPEN","isDraft":false,"headRefName":"1037-chargingstations-rating"}');
    }
    return out('', 1);
  };
  const req = {
    cwd: '/x/acme-app',
    session: 's',
    branch: 'fix/no-cleartext-any-build',
    named: null,
    sessionPr: { number: 1040, url: 'https://github.com/o/r/pull/1040', owned: false },
  };
  const { snapshot } = await refreshPr(req, emptyState(), { run, now: () => NOW });
  assert.deepEqual(snapshot.own, { branch: '1037-chargingstations-rating', ahead: 2, behind: 0 });
  const status = {
    branch: 'fix/no-cleartext-any-build',
    isDirty: true,
    ahead: 0,
    behind: 0,
    worktree: 'acme-app',
    fileStats: { modified: 1, added: 0, deleted: 0, untracked: 0, staged: 0, unstaged: 1, conflicts: 0, trackedFiles: [] },
  };
  const found = gitSpec(gitFromStatus(status, 'acme-app', snapshot), DARK).full.map((s) => s.text);
  assert.ok(found.includes('1037-chargingstations-rating '));
  assert.ok(found.includes('#1040 '));
  assert.ok(found.includes('↑2 '));
  assert.ok(!found.includes('~1 '));
});

test('a PR from another repo the session looked at is not shown as this repo\'s', async () => {
  const run = async (argv) => {
    const [cmd, sub] = argv;
    if (cmd === 'git' && sub === 'remote') return out('https://github.com/alwinpaul1/Thesis.git\n');
    return out('', 1);
  };
  const req = {
    cwd: '/x/Thesis',
    session: 's',
    branch: 'main',
    named: null,
    sessionPr: { number: 1040, url: 'https://github.com/example-org/example-repo/pull/1040', owned: false },
  };
  const { snapshot } = await refreshPr(req, emptyState(), { run, now: () => NOW });
  assert.equal(snapshot.pr, null);
  assert.equal(snapshot.own, undefined);
});

test('a merged session PR gives way to the branch checked out now, and the title PR wins', async () => {
  const calls = [];
  const run = async (argv) => {
    calls.push(argv.join(' '));
    const [cmd, sub, , target] = argv;
    if (cmd === 'gh' && sub === 'pr' && target === '1191') {
      return out('{"number":1191,"state":"MERGED","isDraft":false,"headRefName":"fix/no-cleartext-any-build"}');
    }
    if (cmd === 'gh' && sub === 'pr' && target === '1037') {
      return out('{"number":1037,"state":"OPEN","isDraft":false,"headRefName":"main","baseRefName":"release"}');
    }
    if (cmd === 'git' && sub === 'rev-parse') return out('abc\n');
    if (cmd === 'git' && sub === 'rev-list') return out('17\t2\n');
    return out('', 1);
  };
  const merged = { cwd: '/x/acme-app', session: 's', branch: 'main', named: null, sessionPr: { number: 1191, url: '', owned: true } };
  const first = await refreshPr(merged, emptyState(), { run, now: () => NOW });
  assert.equal(first.snapshot.pr, null);
  const titled = { ...merged, named: 1037 };
  const second = await refreshPr(titled, emptyState(), { run, now: () => NOW });
  assert.equal(second.snapshot.pr?.number, 1037);
  assert.deepEqual(second.snapshot.base, { name: 'release', behind: 17, ahead: 2 });
  assert.equal(typeof second.fetch, 'function');
  await second.fetch();
  assert.ok(calls.some((call) => call.startsWith('git fetch --quiet --no-tags origin release')));
});

test('a fresh PR snapshot is served and a stale or foreign one asks for a refresh', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'claude-hud-pr-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    const req = { cwd: '/x/acme-app', session: 's', branch: 'feat/x', named: null, sessionPr: null };
    const spawned = [];
    const deps = (now) => ({
      now: () => now,
      homeDir: home,
      ensureDir: () => undefined,
      spawnRefresher: (request, paths) => spawned.push(paths),
    });
    assert.equal(resolvePrStatus(req, deps(NOW)), null);
    const dir = path.join(home, '.claude', 'plugins', 'claude-hud-enhanced', 'pr-cache');
    await mkdir(dir, { recursive: true });
    assert.equal(resolvePrStatus(req, deps(NOW)), null);
    assert.equal(spawned.length, 1);
    assert.equal(resolvePrStatus(req, deps(NOW)), null);
    assert.equal(spawned.length, 1);
    const snapshot = { version: 1, at: NOW, request: requestKey(req), pr: { number: 7, state: 'OPEN' } };
    await writeFile(spawned[0].snapshot, JSON.stringify(snapshot));
    await rm(spawned[0].lock, { force: true });
    assert.equal(resolvePrStatus(req, deps(NOW + 1000))?.pr?.number, 7);
    assert.equal(spawned.length, 1);
    assert.equal(resolvePrStatus(req, deps(NOW + 6000))?.pr?.number, 7);
    assert.equal(spawned.length, 2);
    await rm(spawned[0].lock, { force: true });
    assert.equal(resolvePrStatus({ ...req, branch: 'other' }, deps(NOW + 1000)), null);
    assert.equal(spawned.length, 3);
  } finally {
    if (previous !== undefined) process.env.CLAUDE_CONFIG_DIR = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test('a subagent row shows its own type, model, effort and context', () => {
  const agent = { type: 'general-purpose', model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5', effort: 'high', tokens: 40_000 };
  const spec = agentContextSpec(agent, { name: 'Opus 5.5', effort: 'medium' }, { tokens: 1, window: 1_000_000, percent: 0 }, DARK);
  knownWindows.clear();
  assert.equal(spec.full.map((s) => s.text).join(''), ' ↳ general-purpose · Sonnet 5.5 high │ ◔ 40.0k ');
  assert.equal(spec.compact.map((s) => s.text).join(''), ' ↳ general-purpose · Sonnet 5.5 high │ ◔ 40.0k ');
  assert.ok(!spec.full.some((s) => s.text.includes('20%')));
  const sized = agentContextSpec({ ...agent, window: 200_000 }, null, null, DARK);
  assert.equal(sized.full.map((s) => s.text).join(''), ' ↳ general-purpose · Sonnet 5.5 high │ ◔ ━╸━━━━━━ 20% 40.0k/200.0k ');
  const rows = pillRows(band({ agents: [agent, { ...agent, git: { ...GIT, worktree: 'wt-a', isLinked: true } }] }), 200, options());
  assert.deepEqual(rowKeys(rows), [['context', '5h', '7d', 'git'], ['context'], ['context', 'git']]);
  assert.ok(texts(rows).includes(' ↳ general-purpose ·'));
  assert.ok(texts(rows).includes('wt-a'));
  const unknown = agentContextSpec({ ...agent, effort: null, tokens: null }, null, null, DARK);
  assert.equal(unknown.full.map((s) => s.text).join(''), ' ↳ general-purpose · Sonnet 5.5 │ ◔ — ');
});

test('the subagent window is the feed figure, else the session one for the same model, else one a feed reported, else unknown', () => {
  const a = { type: 'general-purpose', model: 'Sonnet 5.5', modelId: 'claude-sonnet-5-5', effort: null, tokens: 1, window: 1_000_000 };
  const text = JSON.stringify({
    session_id: 's1',
    tasks: [
      { id: 'a9', type: 'local_agent', model: 'claude-haiku-4-5-20251001', effort: null, contextWindowSize: 200000, tokenCount: 13419 },
      { id: 'a8', type: 'local_agent', model: 'claude-sonnet-5-5', effort: 'high', contextWindowSize: 1000000, tokenCount: 195671 },
    ],
  });
  const feed = parseAgentFeed(text);
  assert.equal(agentWindow(a, null, null), 1_000_000);
  knownWindows.clear();
  assert.equal(agentWindow({ ...a, window: undefined }, null, null), null);
  assert.equal(agentWindow({ ...a, window: undefined, modelId: 'claude-sonnet-5-5[1m]' }, null, null), null);
  const main = { name: 'Sonnet 5.5', effort: null };
  assert.equal(agentWindow({ ...a, window: undefined }, main, { tokens: 1, window: 500_000, percent: 0 }), 500_000);
  assert.equal(agentWindow({ ...a, window: undefined }, main, { tokens: 1, window: 0, percent: null }), null);
  learnWindows(text);
  assert.equal(agentWindow({ ...a, window: undefined }, null, null), 1_000_000);
  assert.equal(agentWindow({ ...a, window: undefined }, main, { tokens: 1, window: 500_000, percent: 0 }), 500_000);
  assert.equal(agentWindow({ ...a, window: undefined, modelId: 'claude-fable-5-2' }, null, null), null);
  learnWindows('not json\n{"tasks":[{"model":"claude-fable-5-2","contextWindowSize":"big"}]}\n{"tasks":"none"}');
  assert.equal(agentWindow({ ...a, window: undefined, modelId: 'claude-fable-5-2' }, null, null), null);
  knownWindows.clear();
  assert.deepEqual(feed.a9, { modelId: 'claude-haiku-4-5-20251001', window: 200000, tokens: 13419 });
  assert.deepEqual(feed.a8, { modelId: 'claude-sonnet-5-5', effort: 'high', window: 1000000, tokens: 195671 });
});

test('a window is learned from any session feed in the config dir, never from one that is not a feed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-feeds-'));
  try {
    knownWindows.clear();
    seedKnownWindows(path.join(dir, 'missing'));
    assert.equal(knownWindows.size, 0);
    await writeFile(path.join(dir, 'sa-one.json'), JSON.stringify({ tasks: [{ id: 'a', model: 'claude-sonnet-5', contextWindowSize: 1_000_000 }] }, null, 2));
    await writeFile(path.join(dir, 'sa-two.json'), '{"tasks":[{"id":"b","model":"claude-haiku-4-5","contextWindowSize":200000}');
    await writeFile(path.join(dir, 'other.json'), JSON.stringify({ tasks: [{ id: 'c', model: 'claude-opus-5-5', contextWindowSize: 5 }] }));
    await writeFile(path.join(dir, '.sa-tmp.123'), JSON.stringify({ tasks: [{ id: 'd', model: 'claude-fable-5-2', contextWindowSize: 7 }] }));
    seedKnownWindows(dir);
    assert.deepEqual([...knownWindows], [['claude-sonnet-5', 1_000_000]]);
  } finally {
    knownWindows.clear();
    await rm(dir, { recursive: true, force: true });
  }
});

test('running subagents read their type, model, effort and tokens from their own files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-agents-'));
  try {
    const transcriptPath = path.join(dir, 'session.jsonl');
    const agentsDir = path.join(dir, 'session', 'subagents');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      path.join(agentsDir, 'agent-a1.meta.json'),
      JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_1', worktreePath: '/x/wt-a' }),
    );
    const usage = { input_tokens: 1000, cache_read_input_tokens: 39_000, cache_creation_input_tokens: 0, output_tokens: 5 };
    await writeFile(
      path.join(agentsDir, 'agent-a1.jsonl'),
      [
        JSON.stringify({ type: 'user', effort: 'low', message: { role: 'user', content: 'go' } }),
        JSON.stringify({ type: 'assistant', effort: 'high', message: { model: 'claude-sonnet-5-5', usage } }),
        '',
      ].join('\n'),
    );
    const agents = [
      { id: 'toolu_0', type: 'Explore', status: 'completed', startTime: new Date() },
      { id: 'toolu_1', type: 'agent', model: 'sonnet', status: 'running', startTime: new Date() },
      { id: 'toolu_2', type: 'Explore', model: 'haiku', status: 'running', startTime: new Date() },
    ];
    const asked = [];
    const seen = await readRunningSubagents(transcriptPath, agents, async (cwd) => {
      asked.push(cwd);
      return { branch: 'feat/a', isDirty: false, ahead: 1, behind: 0 };
    });
    assert.deepEqual(asked, ['/x/wt-a']);
    assert.deepEqual(seen[0], {
      id: 'toolu_1',
      type: 'general-purpose',
      model: 'claude-sonnet-5-5',
      modelId: 'claude-sonnet-5-5',
      effort: 'high',
      tokens: 40_000,
      worktree: '/x/wt-a',
      git: { branch: 'feat/a', isDirty: false, ahead: 1, behind: 0 },
    });
    assert.deepEqual(seen[1], { id: 'toolu_2', type: 'Explore', model: 'haiku', modelId: 'haiku', effort: null, tokens: null });
    assert.deepEqual(await readRunningSubagents(transcriptPath, [agents[0]], async () => null), []);
    assert.deepEqual(parseAgentTail('not json\n"effort":"max"'), { modelId: null, effort: 'max', tokens: null });
    const ctx = context({ pillAgents: seen });
    const rows = pillRows(bandFromContext(ctx), 200, options());
    assert.ok(texts(rows).includes(' Sonnet 5.5 '));
    assert.ok(texts(rows).includes('feat/a '));
    assert.ok(texts(rows).includes('wt-a'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the transcript yields the PR the session worked on', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'claude-hud-prt-'));
  const previousHome = process.env.HOME;
  const previousConfig = process.env.CLAUDE_CONFIG_DIR;
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    const use = (id, command) => ({
      type: 'assistant',
      timestamp: '2026-10-04T12:00:00Z',
      message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] },
    });
    const result = (id, text, toolUseResult) => ({
      type: 'user',
      timestamp: '2026-10-04T12:00:01Z',
      message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
      ...(toolUseResult ? { toolUseResult } : {}),
    });
    const url = 'https://github.com/acme/app/pull/1200';
    const file = path.join(home, 'session.jsonl');
    const lines = [
      use('u0', 'ls'),
      result('u0', 'https://github.com/acme/app/pull/3'),
      use('u1', 'gh pr create --fill'),
      result('u1', `Creating pull request\n${url}\n`),
      use('u2', 'gh pr view https://github.com/acme/app/pull/1191'),
      result('u2', '', { stdout: 'merged' }),
    ];
    await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    assert.deepEqual((await parseTranscript(file)).sessionPr, { number: 1200, url, owned: true });
    assert.deepEqual((await parseTranscript(file)).sessionPr, { number: 1200, url, owned: true });
    const more = [use('u3', 'git push'), result('u3', 'ok', { gitOperation: { pr: { number: 1300, action: 'created' } } })];
    await writeFile(file, `${[...lines, ...more].map((line) => JSON.stringify(line)).join('\n')}\n`);
    assert.deepEqual((await parseTranscript(file)).sessionPr, { number: 1300, url: '', owned: true });
  } finally {
    if (previousHome !== undefined) process.env.HOME = previousHome;
    if (previousConfig !== undefined) process.env.CLAUDE_CONFIG_DIR = previousConfig;
    await rm(home, { recursive: true, force: true });
  }
});

test('the pill row is opt-in and the compact layout is the default', () => {
  assert.equal(DEFAULT_CONFIG.lineLayout, 'compact');
  assert.equal(mergeConfig({}).lineLayout, 'compact');
  assert.equal(mergeConfig({ lineLayout: 'pills' }).lineLayout, 'pills');
  assert.equal(mergeConfig({ lineLayout: 'expanded' }).lineLayout, 'expanded');
  assert.equal(mergeConfig({ lineLayout: 'nope' }).lineLayout, 'compact');
  assert.equal(mergeConfig({}).display.pillCaps, false);
  assert.equal(mergeConfig({}).display.pillTheme, 'auto');
  assert.equal(mergeConfig({ display: { pillTheme: 'light' } }).display.pillTheme, 'light');
  assert.equal(mergeConfig({ display: { pillTheme: 'sepia' } }).display.pillTheme, 'auto');
  assert.equal(mergeConfig({ display: { pillCaps: false } }).display.pillCaps, false);
  assert.equal(mergeConfig({ display: { pillPr: false } }).display.pillPr, false);
  const pills = capture(context(), 200).map(stripAnsi);
  assert.equal(pills.length, 1);
  assert.match(pills[0], /^ Opus 5\.5 medium │ ◔ ╸━━━━━━━ 7% 69\.0k\/1\.0M   ◷ 5h ━━━╸━━━━ 42% │ /);
  assert.match(pills[0], / ▦ 7d ╸━━━━━━━ 8% │ \w{3} \d{1,2}:\d{2} [AP]M    Thesis │  main ~6 \?3 $/);
  const old = capture(context({ config: mergeConfig({}) }), 200).map(stripAnsi);
  assert.match(old[0], /^\[Opus 5\.5/);
  assert.ok(!old.join('\n').includes(''));
});

test('dark and light palettes both render, picked by setting or by the Claude Code theme', () => {
  const blueBg = (ctx) => capture(ctx, 200)[0].includes('\x1b[48;2;40;46;80m');
  const lightBg = (ctx) => capture(ctx, 200)[0].includes('\x1b[48;2;226;230;250m');
  assert.ok(blueBg(context()));
  assert.ok(blueBg(context({ claudeTheme: 'dark-ansi' })));
  assert.ok(lightBg(context({ claudeTheme: 'light' })));
  assert.ok(lightBg(context({ claudeTheme: 'light-daltonized' })));
  assert.ok(lightBg(context({ config: mergeConfig({ lineLayout: 'pills', display: { pillTheme: 'light' } }) })));
  assert.ok(blueBg(context({ claudeTheme: 'light', config: mergeConfig({ lineLayout: 'pills', display: { pillTheme: 'dark' } }) })));
  const light = capture(context({ claudeTheme: 'light' }), 200)[0];
  assert.ok(light.includes('\x1b[38;2;0;0;0m Opus 5.5 '));
  assert.ok(light.includes('\x1b[38;2;84;100;220mmedium '));
  const dark = capture(context(), 200)[0];
  assert.ok(dark.includes('\x1b[38;2;255;255;255m Opus 5.5 '));
  assert.ok(dark.includes('\x1b[38;2;146;164;255mmedium '));
  assert.ok(dark.includes('\x1b[38;2;40;46;80m'));
  const flat = capture(context({ config: mergeConfig({ lineLayout: 'pills' }) }), 200)[0];
  assert.ok(!flat.includes('') && !flat.includes(''));
});

test('the rendered rows reflow to the pane width', () => {
  const visible = (line) => [...stripAnsi(line)].length;
  for (const columns of [200, 140, 110, 80, 50, 30, 16]) {
    const lines = capture(context(), columns);
    for (const line of lines) assert.ok(visible(line) <= columns, `${columns}: ${stripAnsi(line)}`);
  }
  assert.equal(capture(context(), 200).length, 1);
  assert.equal(capture(context(), 140).length, 2);
  assert.equal(capture(context(), 110).length, 1);
  assert.equal(capture(context(), 30).length, 4);
  assert.ok(capture(context(), 140).map(stripAnsi).join('\n').includes('━━━╸━━━━'));
  assert.ok(!capture(context(), 80).map(stripAnsi).join('\n').includes('━'));
});

test('missing data leaves its pill out and keeps the rest', () => {
  const bare = context({
    stdin: { model: { display_name: 'Opus' } },
    gitStatus: null,
    usageData: null,
    effortLevel: undefined,
  });
  assert.deepEqual(capture(bare, 120).map(stripAnsi), [' Opus │ ◔ — ']);
  const noGit = context({ gitStatus: null, usageData: null });
  assert.equal(
    capture(noGit, 120).map(stripAnsi)[0],
    ' Opus 5.5 medium │ ◔ ╸━━━━━━━ 7% 69.0k/1.0M    Thesis ',
  );
  const weeklyOnly = context({ usageData: { fiveHour: null, sevenDay: 8, fiveHourResetAt: null, sevenDayResetAt: null } });
  const line = capture(weeklyOnly, 200).map(stripAnsi)[0];
  assert.ok(!line.includes('5h'));
  assert.ok(line.includes(' ▦ 7d ╸━━━━━━━ 8% '));
  const routed = context({ stdin: { ...context().stdin, model: { id: 'us.anthropic.claude-opus-4-5-v1:0' } } });
  assert.ok(!capture(routed, 200).map(stripAnsi)[0].includes('5h'));
  const dirty = context({ gitStatus: { branch: 'main', isDirty: true, ahead: 0, behind: 0 } });
  assert.ok(capture(dirty, 200).map(stripAnsi)[0].endsWith(' Thesis │  main ~ '));
});

test('activity lines follow the pills and agent pills replace the agents line', () => {
  const tool = { id: 't1', name: 'Read', target: 'a.ts', status: 'completed', startTime: new Date(), endTime: new Date() };
  const agent = { id: 'a1', type: 'Explore', model: 'haiku', description: 'Finding code', status: 'running', startTime: new Date() };
  const base = context({
    config: mergeConfig({ lineLayout: 'pills', display: { pillCaps: true, toolsLine: true, agentsLine: true, todosLine: true } }),
  });
  base.transcript = { ...base.transcript, tools: [tool], agents: [agent], todos: [{ content: 'Add tests', status: 'in_progress' }] };
  const plain = capture(base, 200).map(stripAnsi);
  assert.ok(plain.some((line) => line.includes('Read')));
  assert.ok(plain.some((line) => line.includes('Finding code')));
  assert.ok(plain.some((line) => line.includes('Add tests')));
  const seen = { type: 'Explore', model: 'claude-haiku-4-5', modelId: 'claude-haiku-4-5', effort: null, tokens: 20_000 };
  const withPills = capture({ ...base, pillAgents: [seen] }, 200).map(stripAnsi);
  assert.equal(withPills[1], ' ↳ Explore · Haiku 4.5 │ ◔ 20.0k ');
  assert.ok(!withPills.some((line) => line.includes('Finding code')));
});

const usageWith = (extraUsage, overrides = {}) => ({
  fiveHour: 40,
  sevenDay: 30,
  fiveHourResetAt: new Date(FIVE_RESET),
  sevenDayResetAt: new Date(SEVEN_RESET),
  ...(extraUsage === undefined ? {} : { extraUsage }),
  ...overrides,
});

const USD = { symbol: '$', decimals: 2 };

test('extra usage is shown only while it is actually being spent', () => {
  assert.equal(extraSpend(null), null);
  assert.equal(extraSpend(usageWith(undefined)), null, 'the API sent no extra_usage');
  assert.equal(extraSpend(usageWith({ enabled: false, utilization: 20, used: 1000, limit: 5000 })), null, 'not enabled');
  assert.equal(extraSpend(usageWith({ enabled: true, utilization: 0, used: 0, limit: 5000 })), null, 'enabled but unused');
  assert.equal(extraSpend(usageWith({ enabled: true, utilization: null, used: null, limit: null })), null);
  assert.deepEqual(extraSpend(usageWith({ enabled: true, utilization: 24.8, used: 1240, limit: 5000 })), { spent: 12.4, limit: 50, percent: 24.8, ...USD });
  assert.deepEqual(extraSpend(usageWith({ enabled: true, utilization: null, used: 1240, limit: 5000 })), { spent: 12.4, limit: 50, percent: 24.8, ...USD }, 'the share is worked out when the API leaves it out');
  assert.deepEqual(extraSpend(usageWith({ enabled: true, utilization: null, used: 1240, limit: null })), { spent: 12.4, limit: null, percent: null, ...USD });
  assert.deepEqual(extraSpend(usageWith({ enabled: true, utilization: 55, used: 1240, limit: 0 })), { spent: 12.4, limit: null, percent: null, ...USD }, 'a zero limit is no limit');
  assert.deepEqual(extraSpend(usageWith({ enabled: true, utilization: 100, used: 5000, limit: 5000 })), { spent: 50, limit: 50, percent: 100, ...USD });
  assert.equal(extraSpend(usageWith({ enabled: true, utilization: 96, used: 4800, limit: 5000, reached: true })).percent, 100, 'the API saying the spend limit is reached counts as the limit');
  assert.deepEqual(extraSpend(usageWith({ enabled: true, utilization: 0, used: 0, limit: 5000 }, { fiveHour: 100 })), { spent: 0, limit: 50, percent: 0, ...USD }, 'a reached 5h limit means the next request is extra usage');
  assert.deepEqual(extraSpend(usageWith({ enabled: true, utilization: 0, used: 0, limit: null }, { sevenDay: 100 })), { spent: 0, limit: null, percent: null, ...USD });
  assert.equal(extraSpend(usageWith({ enabled: false, utilization: 0, used: 0, limit: 5000 }, { fiveHour: 100 })), null, 'a reached limit without extra usage enabled spends nothing');
});

test('amounts are minor units divided by ten to the decimal places, two by default', () => {
  assert.equal(minorToAmount(1240), 12.4);
  assert.equal(minorToAmount(5000), 50);
  assert.equal(minorToAmount(1), 0.01);
  assert.equal(minorToAmount(1240, 0), 1240);
  assert.equal(minorToAmount(12400, 3), 12.4);
  assert.equal(formatAmount(12.4), '12.40');
  assert.equal(formatAmount(0), '0.00');
  assert.equal(formatAmount(1234.567), '1234.57');
  assert.equal(formatAmount(1240, 0), '1240');
  assert.equal(formatLimit(50), '50');
  assert.equal(formatLimit(49.5), '49.50');
  assert.equal(currencySymbol(undefined), '$');
  assert.equal(currencySymbol('usd'), '$');
  assert.equal(currencySymbol('EUR'), '€');
  assert.equal(currencySymbol('GBP'), '£');
  assert.equal(currencySymbol('CHF'), 'CHF ');
  assert.equal(currencySymbol('\x1b[31mXYZ9'), 'MXY ', 'an unknown code is reduced to three letters');
  const spend = { spent: 12.4, limit: 50, percent: 24.8, ...USD };
  assert.equal(spendRatio(spend), '12.40/$50');
  assert.equal(extraSpendLabel(spend), '$12.40/$50');
  assert.equal(extraSpendLabel({ ...spend, limit: null }), '$12.40');
  const yen = extraSpend(usageWith({ enabled: true, utilization: null, used: 1240, limit: 5000, currency: 'JPY', decimals: 0 }));
  assert.deepEqual(yen, { spent: 1240, limit: 5000, percent: 24.8, symbol: '¥', decimals: 0 });
  assert.equal(extraSpendLabel(yen), '¥1240/¥5000');
  const euro = extraSpend(usageWith({ enabled: true, utilization: 10, used: 12345, limit: 123450, currency: 'EUR', decimals: 3 }));
  assert.equal(extraSpendLabel(euro), '€12.345/€123.450');
});

test('the extra usage pill shows spent over limit with a bar, in three sizes and both palettes', () => {
  const text = (segs) => segs.map((seg) => seg.text).join('');
  for (const palette of [DARK, paletteFor('light')]) {
    const spec = extraSpec({ spent: 12.4, limit: 50, percent: 24.8, ...USD }, palette);
    assert.equal(spec.key, 'extra');
    assert.equal(spec.tone, palette.gold);
    assert.equal(text(spec.full), ' $ ━━━━━━━━ 12.40/$50 ');
    assert.equal(spec.full.find((seg) => seg.key === 'extra-fill').text, '━━', 'a quarter of the bar is filled');
    assert.equal(text(spec.compact), ' $ 12.40/$50 ');
    assert.equal(text(spec.tight), ' $12.40 ');
    assert.equal(spec.full.find((seg) => seg.key === 'extra-fill').color, palette.gold.fg);
    const near = extraSpec({ spent: 45, limit: 50, percent: 90, ...USD }, palette);
    assert.equal(near.full.find((seg) => seg.key === 'extra-fill').color, palette.red.fg, 'the bar is red from 90%');
    assert.equal(near.tone, palette.gold);
    const reached = extraSpec({ spent: 50, limit: 50, percent: 100, ...USD }, palette);
    assert.equal(reached.tone, palette.red, 'the whole pill turns red at the limit');
    assert.equal(text(reached.full), ' $ ━━━━━━━━ 50.00/$50 ');
    const open = extraSpec({ spent: 12.4, limit: null, percent: null, ...USD }, palette);
    assert.equal(text(open.full), ' $ 12.40 ', 'no monthly limit: the amount alone, no bar');
    assert.equal(text(open.tight), ' $12.40 ');
    assert.equal(text(extraSpec({ spent: 12.4, limit: 50, percent: 24.8, symbol: '€', decimals: 2 }, palette).compact), ' € 12.40/€50 ');
    assert.ok(drawPill(spec, spec.full, palette, true).includes(`48;2;${/\((.*)\)/.exec(palette.gold.bg)[1].replaceAll(',', ';')}m`));
  }
});

test('the extra usage pill sits after the weekly pills and survives every width', () => {
  const spend = { spent: 12.4, limit: 50, percent: 24.8, ...USD };
  const fable = { label: 'Fable', window: { percentUsed: 30, resetsAt: SEVEN_RESET } };
  assert.deepEqual(rowKeys(pillRows(band({ extra: spend }), 400, options())), [['context', '5h', '7d', 'extra', 'git']]);
  assert.deepEqual(rowKeys(pillRows(band({ extra: spend, scoped: [fable] }), 400, options())), [['context', '5h', '7d-Fable', '7d', 'extra', 'git']]);
  assert.deepEqual(rowKeys(pillRows(band({ extra: null }), 400, options())), [['context', '5h', '7d', 'git']]);
  assert.deepEqual(rowKeys(pillRows(band({ extra: spend, fiveHour: null }), 400, options())), [['context', '7d', 'extra', 'git']]);
  for (const columns of [200, 140, 110, 90, 70, 50, 36, 24, 14]) {
    for (const caps of [true, false]) {
      const rows = pillRows(band({ extra: spend, scoped: [fable] }), columns, options({ caps }));
      assert.ok(rows.flat().some(([spec]) => spec.key === 'extra'), `${columns} columns: the pill is kept`);
      for (const line of renderPillBand(band({ extra: spend, scoped: [fable] }), columns, options({ caps }))) {
        assert.ok([...stripAnsi(line)].length <= columns, `${columns} columns, caps ${caps}`);
      }
    }
  }
  const ctx = context({ usageData: usageWith({ enabled: true, utilization: 24.8, used: 1240, limit: 5000 }) });
  assert.deepEqual(bandFromContext(ctx).extra, spend);
  assert.equal(bandFromContext(context({ usageData: usageWith({ enabled: true, utilization: 0, used: 0, limit: 5000 }) })).extra, null);
  assert.equal(bandFromContext(context({ usageData: null })).extra, null);
});

test('a reading that is old, unconfirmed or rolled past its reset is dimmed and says so, never hidden', () => {
  const text = (segs) => segs.map((seg) => seg.text).join('');
  const base = { percentUsed: 16, resetsAt: FIVE_RESET };
  assert.equal(windowNote(base, NOW), null, 'age not tracked: no note');
  assert.equal(windowNote({ ...base, seenAt: NOW - 149_000 }, NOW), null);
  assert.equal(windowNote({ ...base, seenAt: NOW - 151_000 }, NOW), '2m ago');
  assert.equal(windowNote({ ...base, seenAt: NOW - 4 * 60_000 }, NOW), '4m ago');
  assert.equal(windowNote({ ...base, seenAt: NOW - 3 * 3_600_000 }, NOW), '3h ago');
  assert.equal(windowNote({ ...base, seenAt: NOW - 3 * 24 * 3_600_000 }, NOW), '3d ago');
  assert.equal(windowNote({ ...base, seenAt: null }, NOW), 'unconfirmed');
  assert.equal(windowNote({ ...base, seenAt: NOW, isRolled: true }, NOW), 'reset');

  for (const palette of [DARK, paletteFor('light')]) {
    const fresh = windowSpec('5h', '◷', { ...base, seenAt: NOW - 5_000 }, NOW, palette.green, palette);
    assert.match(text(fresh.full), /^ ◷ 5h ━+╸?━* 16% │ .+ $/u);
    assert.equal(fresh.full.find((seg) => seg.key === 'pct').bold, true);

    const stale = windowSpec('5h', '◷', { ...base, seenAt: NOW - 4 * 60_000 }, NOW, palette.green, palette);
    assert.match(text(stale.full), /^ ◷ 5h ━+╸?━* ~16% · 4m ago │ .+ $/u);
    assert.match(text(stale.compact), /^ ◷ 5h ~16% · 4m ago │ .+ $/u);
    assert.equal(text(stale.tight), ' ◷ 5h ~16% ');
    assert.equal(stale.full.find((seg) => seg.key === 'pct').color, palette.tray.fg, 'the figure is dimmed');
    assert.notEqual(stale.full.find((seg) => seg.key === 'pct').bold, true);
    assert.equal(stale.full.find((seg) => seg.key === '5h-fill').color, palette.tray.fg);

    const unconfirmed = windowSpec('5h', '◷', { percentUsed: 11, resetsAt: FIVE_RESET, seenAt: null }, NOW, palette.green, palette);
    assert.match(text(unconfirmed.compact), /^ ◷ 5h ~11% · unconfirmed │ /u);

    const over = windowSpec('5h', '◷', { percentUsed: 80, resetsAt: NOW - 60_000, seenAt: NOW - 3_600_000 }, NOW, palette.green, palette);
    assert.match(text(over.compact), /^ ◷ 5h ~0% · reset │ /u, 'a window whose reset passed reads 0% and says why');
    const preRolled = windowSpec('7d', '▦', { percentUsed: 0, resetsAt: SEVEN_RESET, seenAt: NOW, isRolled: true }, NOW, palette.purple, palette);
    assert.match(text(preRolled.compact), /^ ▦ 7d ~0% · reset │ /u);
  }

  const rows = pillRows(band({ fiveHour: { ...base, seenAt: NOW - 9 * 24 * 3_600_000 } }), 400, options());
  assert.deepEqual(rowKeys(rows), [['context', '5h', '7d', 'git']], 'however old, the pill stays');
  const ctx = context({ usageData: usageWith(undefined, { fiveHourSeenAt: new Date(Date.now() - 10 * 60_000), sevenDaySeenAt: null, sevenDayRolled: true }) });
  const shown = bandFromContext(ctx);
  assert.ok(Date.now() - shown.fiveHour.seenAt >= 10 * 60_000);
  assert.equal(shown.sevenDay.seenAt, null);
  assert.equal(shown.sevenDay.isRolled, true);
  assert.equal('seenAt' in bandFromContext(context({ usageData: usageWith(undefined) })).fiveHour, false);
});

test('only the usage the account has is drawn: no placeholder for a window without a figure', () => {
  const weekly = { percentUsed: 8, resetsAt: SEVEN_RESET };
  const usageKeys = (overrides) => usageSpecs(band(overrides), NOW, DARK).map((spec) => spec.key);
  assert.deepEqual(usageKeys({ fiveHour: null, sevenDay: weekly }), ['7d'], 'a response with only seven_day draws exactly one usage pill');
  assert.deepEqual(usageKeys({}), ['5h', '7d']);
  assert.deepEqual(usageKeys({ fiveHour: null, sevenDay: null }), []);
  assert.deepEqual(usageKeys({ fiveHour: { percentUsed: Number.NaN, resetsAt: null }, sevenDay: { percentUsed: null, resetsAt: SEVEN_RESET } }), []);
  const ghost = { label: 'Ghost', window: { percentUsed: null, resetsAt: SEVEN_RESET } };
  const fable = { label: 'Fable', window: { percentUsed: 30, resetsAt: SEVEN_RESET } };
  assert.deepEqual(usageKeys({ fiveHour: null, sevenDay: null, scoped: [ghost, fable] }), ['7d-Fable']);
  assert.deepEqual(usageKeys({ scoped: [ghost], extra: null }), ['5h', '7d']);
  assert.deepEqual(usageKeys({ fiveHour: null, sevenDay: null, extra: { spent: 12.4, limit: 50, percent: 24.8, ...USD } }), ['extra']);

  for (const columns of [...WIDTHS, 400]) {
    for (const palette of [DARK, paletteFor('light')]) {
      const rows = pillRows(band({ fiveHour: null, sevenDay: weekly }), columns, options({ palette }));
      assert.deepEqual(rowKeys(rows).flat(), ['context', '7d', 'git'], `${columns} columns`);
      const usage = rows.flat().filter(([spec]) => spec.key !== 'context' && spec.key !== 'git');
      assert.equal(usage.length, 1, `${columns} columns: one usage pill`);
      for (const line of renderPillBand(band({ fiveHour: null, sevenDay: weekly }), columns, options({ palette })).map(stripAnsi)) {
        assert.doesNotMatch(line, /no limit|5h|[◷▦] \S+ —/u, `${columns} columns`);
      }
    }
  }
  const ctx = context({ usageData: { fiveHour: null, sevenDay: 8, fiveHourResetAt: null, sevenDayResetAt: null } });
  assert.equal(bandFromContext(ctx).fiveHour, null);
  assert.equal('noLimit' in bandFromContext(ctx), false);
  assert.deepEqual(rowKeys(pillRows(bandFromContext(ctx), 400, options())).flat().filter((key) => key !== 'context' && key !== 'git' && key !== 'folder'), ['7d']);
  const rolled5h = pillRows(band({ fiveHour: { percentUsed: 93, resetsAt: NOW - 1_000 } }), 400, options());
  assert.match(texts(rolled5h).join(''), / ◷ 5h .*~0% · reset │ /u, 'a 5h window that was open stays, rolled on, after its reset');
});

test('model weekly windows get their own pill between the 5h and 7d ones, named for the model alone', () => {
  const text = (segs) => segs.map((seg) => seg.text).join('');
  const scoped = [
    { label: 'Fable', window: { percentUsed: 30, resetsAt: SEVEN_RESET } },
    { label: 'Opus', window: { percentUsed: 100, resetsAt: SEVEN_RESET } },
    { label: 'Sonnet', window: { percentUsed: 1, resetsAt: null } },
  ];
  const rows = pillRows(band({ scoped }), 600, options());
  assert.deepEqual(rowKeys(rows), [['context', '5h', '7d-Fable', '7d-Opus', '7d', 'git']], 'two at most');
  const fable = rows[0].find(([spec]) => spec.key === '7d-Fable');
  assert.equal(text(fable[0].full), ' ▦ Fable ━━╸━━━━━ 30% ');
  assert.equal(text(fable[0].compact), ' ▦ Fable 30% ');
  assert.equal(text(fable[0].tight), ' ▦ Fable 30% ');
  assert.equal(fable[0].tone, DARK.teal);
  const opus = rows[0].find(([spec]) => spec.key === '7d-Opus');
  assert.equal(opus[0].tone, DARK.red);
  assert.equal(text(opus[0].full), ' ▦ Opus  limit reached ');
  assert.equal(text(opus[0].tight), ' ▦ Opus ✕ ');
  const over = windowSpec('Fable', '▦', { percentUsed: 70, resetsAt: NOW - 1_000 }, NOW, DARK.purple, DARK, 7 * 24 * 3_600_000, '7d-Fable');
  assert.match(text(over.compact), /^ ▦ Fable ~0% · reset │ /u, 'a model window rolls on the weekly span');
  const ctx = context({ usageData: usageWith(undefined, { scopedWindows: [{ label: 'Fa\x1b[31mble', percent: 30, resetAt: new Date(SEVEN_RESET) }, { label: 'Ghost', percent: null, resetAt: null }] }) });
  assert.deepEqual(bandFromContext(ctx).scoped, [{ label: 'Fable', window: { percentUsed: 30, resetsAt: SEVEN_RESET } }]);
  assert.deepEqual(bandFromContext(context({ usageData: usageWith(undefined) })).scoped, []);
});


test('a model weekly pill drops its reset only when the 7d pill beside it shows the same one', () => {
  const text = (segs) => segs.map((seg) => seg.text).join('');
  const fable = { label: 'Fable', window: { percentUsed: 43, resetsAt: SEVEN_RESET } };
  const weekly = (resetsAt) => ({ percentUsed: 34, resetsAt });

  const same = scopedSpec(fable, weekly(SEVEN_RESET + 59_000), NOW, DARK);
  assert.equal(same.key, '7d-Fable');
  assert.equal(same.tone, DARK.teal);
  assert.equal(text(same.full), ' ▦ Fable ━━━╸━━━━ 43% ');
  assert.equal(text(same.compact), ' ▦ Fable 43% ');
  assert.equal(text(same.tight), ' ▦ Fable 43% ');

  for (const [label, other] of [['a different reset', weekly(SEVEN_RESET + 60_000)], ['a 7d window without a reset', weekly(null)], ['no 7d window', null]]) {
    const own = scopedSpec(fable, other, NOW, DARK);
    assert.match(text(own.full), /^ ▦ Fable ━━━╸━━━━ 43% │ \S.* $/u, label);
    assert.match(text(own.compact), /^ ▦ Fable 43% │ \S.* $/u, label);
    assert.equal(text(own.tight), ' ▦ Fable 43% ', label);
  }

  const past = { percentUsed: 70, resetsAt: NOW - 1_000 };
  assert.equal(text(scopedSpec({ label: 'Fable', window: past }, past, NOW, DARK).compact), ' ▦ Fable ~0% · reset ');

  const pillOf = (overrides) => text(pillRows(band({ scoped: [fable], ...overrides }), 600, options())[0].find(([spec]) => spec.key === '7d-Fable')[1]);
  assert.equal(pillOf({ sevenDay: weekly(SEVEN_RESET) }), ' ▦ Fable ━━━╸━━━━ 43% ');
  assert.match(pillOf({ sevenDay: weekly(SEVEN_RESET + 3_600_000) }), / 43% │ \S.* $/u);
  assert.match(pillOf({ sevenDay: null }), / 43% │ \S.* $/u, 'no 7d pill');
  assert.match(pillOf({ sevenDay: { percentUsed: null, resetsAt: SEVEN_RESET } }), / 43% │ \S.* $/u, 'a 7d window without a figure draws no pill to carry the reset');
});

test('the 5h, model weekly and 7d pills keep their order and share a row when that costs no extra one', () => {
  const pill = (key, n) => ({
    key,
    tone: DARK.tray,
    full: [{ key: 'a', text: 'x'.repeat(n * 2) }],
    compact: [{ key: 'a', text: 'x'.repeat(n) }],
    tight: [{ key: 'a', text: 'x'.repeat(n) }],
  });
  const trio = [pill('context', 10), pill('5h', 6), pill('7d-Fable', 6), pill('7d', 6)];
  assert.deepEqual(rowKeys(layout(trio, 28, 2)), [['context'], ['5h', '7d-Fable', '7d']]);
  assert.deepEqual(rowKeys(layout([...trio, pill('extra', 6)], 28, 2)), [['context', '5h'], ['7d-Fable', '7d', 'extra']], 'not at the price of a row');
  for (const columns of [10, 12, 20, 24, 28, 30, 36, 60, 100]) {
    assert.deepEqual(rowKeys(layout([...trio, pill('extra', 6)], columns, 2)).flat(), ['context', '5h', '7d-Fable', '7d', 'extra'], `${columns} columns`);
  }
});
const CAP_L = String.fromCodePoint(0xe0b6);
const CAP_R = String.fromCodePoint(0xe0b4);
const WIDTHS = [40, 52, 60, 80, 100, 120, 200];
const PR_GIT = {
  ...GIT,
  worktree: 'acme-app',
  isLinked: false,
  branch: 'fix/long-branch-name-review',
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicts: 0,
  isCheckedOut: false,
  pr: { number: 1971, state: 'OPEN', ready: 'failing', checks: { failing: 0, pending: 1, passing: 0 } },
};
const crowded = (overrides = {}) =>
  band({
    context: { tokens: 50_000, window: 200_000, percent: 25 },
    fiveHour: { percentUsed: 50, resetsAt: FIVE_RESET, seenAt: NOW - 5_000 },
    sevenDay: { percentUsed: 34, resetsAt: SEVEN_RESET, seenAt: NOW - 5_000 },
    scoped: [{ label: 'Fable', window: { percentUsed: 30, resetsAt: SEVEN_RESET } }],
    extra: { spent: 12.4, limit: 50, percent: 24.8, symbol: '$', decimals: 2 },
    git: PR_GIT,
    ...overrides,
  });
const KINDS = ['context', '5h', '7d-Fable', '7d', 'extra', 'git'];
const bodyOf = (segs) => segs.map((seg) => seg.text).join('');

function drawn(bandUnderTest, columns, extra = {}) {
  const rows = pillRows(bandUnderTest, columns, options(extra));
  const lines = renderPillBand(bandUnderTest, columns, options(extra)).map(stripAnsi);
  return { rows, lines, keys: rows.map((row) => row.map(([spec]) => spec.key)) };
}

function expectSound({ rows, lines }, columns, label) {
  assert.equal(lines.length, rows.length, label);
  for (const [index, row] of rows.entries()) {
    const line = lines[index];
    assert.ok([...line].length <= columns, `${label}: row ${index} is ${[...line].length} cells: ${JSON.stringify(line)}`);
    assert.ok(!line.includes('\n'), label);
    assert.equal(line, row.map(([, segs]) => `${CAP_L}${bodyOf(segs)}${CAP_R}`).join(' '), `${label}: every pill is whole, capped on both sides and as wide as its text`);
    for (const [, segs] of row) {
      const body = bodyOf(segs);
      assert.doesNotMatch(body, /[│·/]\s*$/u, `${label}: dangling separator in ${JSON.stringify(body)}`);
      assert.doesNotMatch(body, /\s{2,}$/u, `${label}: trailing gap in ${JSON.stringify(body)}`);
      assert.ok(segs.every((seg) => seg.key !== 'pad' || seg.text === ' '), `${label}: no pill is padded out to a column`);
    }
  }
}

test('every pill at once fits a pane of any width, each pill as wide as its text and whole', () => {
  for (const columns of WIDTHS) {
    const view = drawn(crowded(), columns);
    const label = `${columns} columns`;
    expectSound(view, columns, label);
    assert.deepEqual(view.keys.flat(), KINDS, `${label}: all six pills, once each, in order`);
    const fable = bodyOf(view.rows.flat().find(([spec]) => spec.key === '7d-Fable')[1]);
    assert.match(fable, /^ ▦ Fable ([━╸]+ )?30% $/u, `${label}: the model pill is named for the model and leaves the shared reset to 7d`);
    const apart = drawn(crowded({ scoped: [{ label: 'Fable', window: { percentUsed: 30, resetsAt: SEVEN_RESET + 3 * 3_600_000 } }] }), columns);
    expectSound(apart, columns, `${label}, a reset of its own`);
    assert.deepEqual(apart.keys.flat(), KINDS, `${label}, a reset of its own: in order`);
    const sized = apart.rows.flat().find(([spec]) => spec.key === '7d-Fable');
    if (sized[1] !== sized[0].tight) assert.match(bodyOf(sized[1]), /^ ▦ Fable ([━╸]+ )?30% │ \S.* $/u, `${label}: a reset of its own is shown`);
    assert.deepEqual(view.keys[view.keys.length - 1], ['git'], `${label}: git has the last row to itself`);
    const git = bodyOf(view.rows.flat().find(([spec]) => spec.key === 'git')[1]);
    assert.match(git, /#1971 /, label);
    assert.match(git, /◷ 1 running /, label);
    assert.match(git, /◌ $/u, label);
  }
  const at52 = drawn(crowded(), 52).keys;
  assert.deepEqual(at52, [['context', '5h'], ['7d-Fable', '7d'], ['extra'], ['git']]);
  assert.deepEqual(drawn(crowded(), 80).keys, [['context', '5h', '7d-Fable', '7d', 'extra'], ['git']], 'the three usage pills share a row at 80');
  assert.ok(at52.length <= 4, `52 columns took ${at52.length} rows`);
  assert.ok(at52.some((row) => row.length >= 2), 'short pills sit side by side');
  assert.ok(drawn(crowded(), 200).keys.length <= 2);
  assert.equal(drawn(crowded(), 400).keys.length, 1);
});

test('a pane with few rows to spare packs the pills tighter instead of spilling over', () => {
  for (const columns of WIDTHS) {
    const roomy = drawn(crowded(), columns);
    const tight = drawn(crowded(), columns, { maxRows: 3 });
    expectSound(tight, columns, `${columns} columns, three rows`);
    assert.ok(tight.rows.length <= roomy.rows.length, `${columns} columns: ${tight.rows.length} rows against ${roomy.rows.length}`);
    assert.equal(tight.keys.flat().length, 6, `${columns} columns keeps all six pills`);
  }
});

test('age labels and a plan without a 5h window fit a narrow pane too', () => {
  const weeklyOnly = crowded({ fiveHour: null, extra: { spent: 12.4, limit: null, percent: null, symbol: '$', decimals: 2 } });
  for (const columns of WIDTHS) {
    const view = drawn(weeklyOnly, columns);
    expectSound(view, columns, `no 5h window at ${columns}`);
    assert.deepEqual(view.keys.flat(), KINDS.filter((kind) => kind !== '5h'), `${columns} columns: no pill for the window the plan lacks`);
    assert.doesNotMatch(view.lines.join(' '), /no limit|5h|—/u, `${columns} columns`);
  }

  const aged = crowded({
    fiveHour: null,
    sevenDay: { percentUsed: 34, resetsAt: SEVEN_RESET, seenAt: NOW - 215_000 },
  });
  for (const columns of WIDTHS) {
    const view = drawn(aged, columns);
    expectSound(view, columns, `aged 7d at ${columns}`);
    assert.match(bodyOf(view.rows.flat().find(([spec]) => spec.key === '7d')[1]), /~34%/, `${columns} columns`);
  }
  assert.match(bodyOf(drawn(aged, 60).rows.flat().find(([spec]) => spec.key === '7d')[1]), / · \dm ago/);
  for (const state of [
    { fiveHour: { percentUsed: 11, resetsAt: FIVE_RESET, seenAt: null } },
    { sevenDay: { percentUsed: 90, resetsAt: NOW - 1_000, seenAt: NOW - 3_600_000 } },
    { fiveHour: { percentUsed: 100, resetsAt: FIVE_RESET, seenAt: NOW }, extra: { spent: 50, limit: 50, percent: 100, symbol: '$', decimals: 2 } },
  ]) {
    for (const columns of WIDTHS) expectSound(drawn(crowded(state), columns), columns, `${Object.keys(state)} at ${columns}`);
  }
});

test('a long worktree, branch and PR line is cut to the pane, never wrapped or left dangling', () => {
  const long = { ...PR_GIT, worktree: 'claude-hud-enhanced', isLinked: true, branch: 'fix/no-cleartext-any-build-variant-on-release', base: { name: 'main', behind: 3, ahead: 1 } };
  for (const columns of [12, 16, 20, 28, ...WIDTHS]) {
    for (const caps of [true, false]) {
      const view = drawn(crowded({ git: long }), columns, { caps });
      for (const line of view.lines) assert.ok([...line].length <= columns, `${columns} columns, caps ${caps}: ${JSON.stringify(line)}`);
      const git = bodyOf(view.rows.flat().find(([spec]) => spec.key === 'git')[1]);
      assert.doesNotMatch(git, /[│·/]\s*…?$/u, `${columns} columns: ${JSON.stringify(git)}`);
      assert.deepEqual(view.keys[view.keys.length - 1], ['git']);
    }
  }
  const spec = gitSpec(long, DARK);
  for (let cells = 90; cells >= 2; cells--) {
    const cut = bodyOf(clip(spec.tight, cells));
    assert.ok([...cut].length <= cells, `${cells} cells: ${JSON.stringify(cut)}`);
    if ([...bodyOf(spec.tight)].length > cells) assert.match(cut, /[^\s│·/]…$|^…$/u, `${cells} cells ends on the cut mark: ${JSON.stringify(cut)}`);
  }
  assert.equal(clip(spec.tight, 500), spec.tight, 'a pill that fits is left alone');
  assert.equal(bodyOf(clip([{ key: 'a', text: ' main ' }, { key: 'sep', text: '│ ' }, { key: 'b', text: 'abcdef' }], 8)), ' main…');
  assert.equal(bodyOf(clip([{ key: 'a', text: ' 12.40' }, { key: 'b', text: '/$50 ' }], 8)), ' 12.40…');
  assert.ok(bodyOf(drawn(crowded({ git: long }), 200).rows.flat().find(([shown]) => shown.key === 'git')[1]).includes('fix/no-cleartext-any-build-variant-on-release'));
});
