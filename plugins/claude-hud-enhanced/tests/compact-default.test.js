import './helpers/isolate-env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/render/index.js';
import { mergeConfig } from '../dist/config.js';
import { compactToolName, shortenMcpServer, shortenToolName } from '../dist/render/tools-line.js';
import { colorDepthFor, drawPill, gitSpec, paletteFor, renderPillBand, to256 } from '../dist/render/pills.js';
import { formatExtraSpend, formatUsageFigure, usageNote } from '../dist/render/usage-figure.js';
import { extraSpend } from '../dist/extra-usage.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WIDTHS = [40, 60, 80, 100, 120, 200];
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const LONG_BRANCH = 'feature/rework-the-billing-export-pipeline-for-large-accounts';

const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
const cells = (text) => [...strip(text)].length;

function withColumns(columns, run) {
  const previous = process.env.COLUMNS;
  process.env.COLUMNS = String(columns);
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.COLUMNS;
    else process.env.COLUMNS = previous;
  }
}

function capture(ctx, columns) {
  const lines = [];
  withColumns(columns, () => render(ctx, (line) => lines.push(line)));
  return lines;
}

const plain = (ctx, columns) => capture(ctx, columns).map(strip);

function weeklyOnlyUsage(now = Date.now()) {
  const weekly = new Date(now + 3 * DAY);
  return {
    fiveHour: null,
    sevenDay: 21,
    fiveHourResetAt: null,
    sevenDayResetAt: weekly,
    scopedWindows: [{ label: 'Fable', percent: 38, resetAt: new Date(weekly.getTime() + 400) }],
    sevenDaySeenAt: new Date(now - 4 * MINUTE),
    extraUsage: { enabled: true, used: 1240, limit: 5000, utilization: 24.8, currency: 'USD', reached: false, decimals: 2 },
  };
}

function context(overrides = {}, config = {}) {
  return {
    stdin: {
      cwd: '/work/acme-app',
      model: { display_name: 'Fable 5.2', id: 'claude-fable-5-2' },
      context_window: {
        context_window_size: 1_000_000,
        used_percentage: 30,
        current_usage: { input_tokens: 300_300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    },
    transcript: { tools: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    sessionDuration: '',
    effortLevel: 'medium',
    gitStatus: {
      branch: 'chore/design-sync',
      isDirty: true,
      ahead: 0,
      behind: 0,
      worktree: 'acme-app',
      isLinked: false,
      fileStats: { modified: 3, added: 0, deleted: 0, untracked: 1, staged: 0, unstaged: 3, conflicts: 0, trackedFiles: [] },
    },
    usageData: weeklyOnlyUsage(),
    config: mergeConfig(config),
    extraLabel: null,
    claudeTheme: 'dark',
    ...overrides,
  };
}

const done = (name, index) => ({ id: `t${index}`, name, status: 'completed', startTime: new Date(0), endTime: new Date(0) });

function manyTools() {
  const names = [
    ...Array(16).fill('mcp__claude-in-chrome__browser_batch'),
    ...Array(2).fill('mcp__plugin_acme_acme__execute_sql'),
    'Bash',
    'mcp__claude-in-chrome__computer',
    'mcp__claude_ai_Acme_Drive__search_files',
    'Read',
    'Edit',
  ];
  return [
    ...names.map(done),
    { id: 'run', name: 'mcp__plugin_acme_acme-docs__search_documentation', target: 'src/render/session-line.ts', status: 'running', startTime: new Date() },
  ];
}

const runningAgent = (id, extra = {}) => ({
  id,
  type: 'Explore',
  model: 'claude-haiku-4-5-20251001',
  description: 'Finding every caller of the billing export pipeline',
  status: 'running',
  startTime: new Date(Date.now() - 135_000),
  ...extra,
});

test('the default layout is the compact two-row header with every new reading in the old style', () => {
  const [row, usage, ...rest] = plain(context(), 200);

  assert.deepEqual(rest, [], 'nothing below the header by default');
  assert.equal(row, '[Fable 5.2 medium] ███░░░░░░░ 30% (300k/1.0M) | acme-app git:(chore/design-sync* !3 ?1)');
  assert.match(
    usage,
    /^Fable ████░░░░░░ 38% \| Weekly ██░░░░░░░░ ~21% · 4m ago \(resets \w{3} \d{1,2}:\d{2}\s?[AP]M\) \| extra \$12\.40\/\$50$/,
  );
  assert.doesNotMatch(`${row}\n${usage}`, /5h|--|undefined|NaN|null/);
});

test('the default header narrows step by step and never wraps or overflows from 40 to 200 columns', () => {
  const byWidth = Object.fromEntries(WIDTHS.map((columns) => [columns, plain(context(), columns)]));

  for (const columns of WIDTHS) {
    const lines = byWidth[columns];
    assert.equal(lines.length, 2, `${columns} columns: ${JSON.stringify(lines)}`);
    for (const line of lines) assert.ok(cells(line) <= columns, `${columns} columns: ${cells(line)} cells: ${line}`);
    assert.match(lines[1], /Fable:? .*38%.*\| (Weekly|7d:) .*~21%/, `${columns} columns keeps Fable before the weekly window`);
    assert.ok(lines[1].includes('$12.40'), `${columns} columns keeps the amount being spent`);
    assert.doesNotMatch(lines.join('\n'), /\.\.\.|5h|--/, `${columns} columns`);
  }
  assert.equal(byWidth[120][0], byWidth[200][0]);
  assert.equal(byWidth[100][1], byWidth[200][1]);
  assert.equal(byWidth[80][0], '[Fable 5.2 medium] ██░░░░ 30% | acme-app git:(chore/design-sync* !3 ?1)');
  assert.match(byWidth[80][1], /^Fable 38% \| Weekly ~21% · 4m ago \(resets [^)]+\) \| extra \$12\.40\/\$50$/);
  assert.equal(byWidth[60][0], '[Fable 5.2 medium] ██░░░░ 30% | acme-app git:(chore/desig…*)');
  assert.equal(byWidth[60][1], 'Fable: 38% | 7d: ~21% · 4m ago | extra $12.40/$50');
  assert.equal(byWidth[40][0], '[Fable 5.2 medium] █░░░ 30% | acme-app');
  assert.equal(byWidth[40][1], 'Fable: 38% | 7d: ~21% | extra $12.40/$50');
});

test('the old layouts use the terminal palette, so a light and a dark theme render the same bytes', () => {
  for (const lineLayout of ['compact', 'expanded']) {
    const dark = capture(context({ claudeTheme: 'dark' }, { lineLayout }), 120);
    const light = capture(context({ claudeTheme: 'light' }, { lineLayout }), 120);

    assert.deepEqual(light, dark, lineLayout);
    assert.doesNotMatch(dark.join('\n'), /\x1b\[[34]8;[25];/, `${lineLayout}: no fixed foreground or background colours`);
    assert.doesNotMatch(dark.join('\n'), /[-]/u, `${lineLayout}: no private-use glyphs`);
  }
});

test('the model weekly window sits between 5h and 7d in its own colour and borrows the weekly reset', () => {
  const now = Date.now();
  const weekly = new Date(now + 3 * DAY);
  const usageData = {
    fiveHour: 25,
    sevenDay: 21,
    fiveHourResetAt: new Date(now + 2 * HOUR),
    sevenDayResetAt: weekly,
    scopedWindows: [{ label: 'Fable', percent: 38, resetAt: new Date(weekly.getTime() + 400) }],
  };
  const raw = capture(context({ usageData }), 200)[1];
  const usage = strip(raw);

  assert.match(usage, /^Usage ███░+ 25% \(resets [^)]+\) \| Fable ████░+ 38% \| Weekly ██░+ 21% \(resets [^)]+\)$/);
  assert.equal(usage.match(/resets/g).length, 2, 'Fable prints no reset of its own');
  assert.ok(raw.includes(`${CYAN}38%`), 'Fable is drawn in the model colour');
  assert.ok(raw.includes(`${CYAN}████`), 'and so is its bar');
  assert.ok(raw.includes(`${GREEN}25%`) && raw.includes(`${GREEN}21%`), 'the account windows keep the usage colour');
  assert.ok(raw.includes(`${DIM}(resets `), 'reset times are dimmed');

  const own = { ...usageData, scopedWindows: [{ label: 'Fable', percent: 38, resetAt: new Date(now + DAY) }] };
  assert.equal(strip(capture(context({ usageData: own }), 200)[1]).match(/resets/g).length, 3, 'a different reset is printed');

  const hot = (percent) => capture(context({ usageData: { ...usageData, scopedWindows: [{ label: 'Fable', percent, resetAt: weekly }] } }), 200)[1];
  assert.ok(hot(80).includes(`${YELLOW}80%`), 'the warning colour still applies');
  assert.ok(hot(95).includes(`${RED}95%`), 'and the critical colour');

  const painted = capture(context({ usageData }, { colors: { modelUsage: 'magenta' } }), 200)[1];
  assert.ok(painted.includes('\x1b[35m38%'), 'colors.modelUsage overrides it');

  const terse = strip(capture(context({ usageData }, { display: { usageCompact: true } }), 200)[1]);
  assert.match(terse, /^5h: 25% \([^)]+\) \| Fable: 38% \| 7d: 21% \([^)]+\)$/);

  const expanded = plain(context({ usageData }, { lineLayout: 'expanded' }), 200).find((line) => line.includes('Usage'));
  assert.match(expanded, /Usage ███░+ 25% \(resets [^)]+\) \| Fable ████░+ 38% \| Weekly ██░+ 21% \(resets [^)]+\)$/);
});

test('a reading that was not just confirmed is dimmed with its age, and a window that rolled over reads reset', () => {
  const now = Date.now();
  const usageData = {
    fiveHour: 16,
    sevenDay: 0,
    fiveHourResetAt: new Date(now + 2 * HOUR),
    sevenDayResetAt: new Date(now + 6 * DAY),
    fiveHourSeenAt: new Date(now - 4 * MINUTE),
    sevenDayRolled: true,
  };
  for (const lineLayout of ['compact', 'expanded']) {
    const raw = capture(context({ usageData }, { lineLayout }), 200).find((line) => strip(line).includes('Weekly'));
    const usage = strip(raw);

    assert.match(usage, /~16% · 4m ago \(resets [^)]+\) \| Weekly ░+ ~0% · reset \(resets [^)]+\)$/, lineLayout);
    assert.ok(raw.includes(`${DIM}~16% · 4m ago`), `${lineLayout}: the aged figure is dimmed`);
    assert.ok(raw.includes(`${DIM}~0% · reset`), `${lineLayout}: so is the rolled one`);
  }

  const fresh = { ...usageData, fiveHourSeenAt: new Date(now - 30_000), sevenDayRolled: false, sevenDay: 8 };
  assert.doesNotMatch(strip(capture(context({ usageData: fresh }), 200)[1]), /~|ago|reset \(/);

  const unconfirmed = { ...fresh, fiveHourSeenAt: null, sevenDaySeenAt: null };
  assert.match(strip(capture(context({ usageData: unconfirmed }), 200)[1]), /~16% · unconfirmed .*~8% · unconfirmed/);

  assert.equal(usageNote({ fiveHourSeenAt: new Date(now - 3 * HOUR) }, 'fiveHour', now), '3h ago');
  assert.equal(usageNote({ fiveHourSeenAt: new Date(now - MINUTE) }, 'fiveHour', now), null);
  assert.equal(usageNote({}, 'sevenDay', now), null);
  assert.equal(strip(formatUsageFigure(16, { note: '4m ago', showNote: false })), '~16%');
  assert.equal(formatUsageFigure(null), '', 'a window with no figure draws nothing');
});

test('an age label replaces the stale marker instead of repeating it', () => {
  const now = Date.now();
  const usageData = { ...weeklyOnlyUsage(now), staleSince: new Date(now - 4 * MINUTE) };
  for (const lineLayout of ['compact', 'expanded']) {
    const aged = plain(context({ usageData }, { lineLayout }), 200).join('\n');
    assert.ok(aged.includes('· 4m ago') && !aged.includes('stale'), `${lineLayout}: ${aged}`);

    const unstamped = { ...usageData, sevenDaySeenAt: undefined };
    assert.ok(plain(context({ usageData: unstamped }, { lineLayout }), 200).join('\n').includes('stale'), `${lineLayout}: no age to show`);
  }
});

test('extra usage shows only while it is being spent, and only windows with a figure are drawn', () => {
  const usage = (extraUsage, more = {}) => ({ ...weeklyOnlyUsage(), extraUsage, ...more });
  const row = (usageData, config = {}) => plain(context({ usageData }, config), 200).join('\n');

  assert.ok(row(usage({ enabled: true, used: 1240, limit: 5000, utilization: 24.8 })).includes('| extra $12.40/$50'));
  assert.doesNotMatch(row(usage({ enabled: true, used: 0, limit: 5000, utilization: 0 })), /extra|\$/);
  assert.doesNotMatch(row(usage({ enabled: false, used: 1240, limit: 5000, utilization: 24.8 })), /extra|\$/);
  assert.doesNotMatch(row(usage(undefined)), /extra|\$/);
  assert.ok(row(usage({ enabled: true, used: 1240, limit: 5000, utilization: 24.8 }), { lineLayout: 'expanded' }).includes('| extra $12.40/$50'));
  assert.ok(row(usage({ enabled: true, used: 1240, limit: null, utilization: null })).includes('| extra $12.40'));

  const spending = extraSpend(usage({ enabled: true, used: 1240, limit: 5000, utilization: 24.8 }));
  assert.ok(formatExtraSpend(spending, undefined).includes(`${YELLOW}$12.40/$50`));
  assert.equal(strip(formatExtraSpend(spending, undefined, 'short')), '$12.40');
  const spent = extraSpend(usage({ enabled: true, used: 5000, limit: 5000, utilization: 100, reached: true }));
  assert.ok(formatExtraSpend(spent, undefined).includes(`${RED}$50.00/$50`));

  const bare = { fiveHour: null, sevenDay: null, fiveHourResetAt: null, sevenDayResetAt: null, scopedWindows: [{ label: 'Fable', percent: null, resetAt: null }] };
  for (const lineLayout of ['compact', 'expanded']) {
    for (const usageCompact of [false, true]) {
      const text = plain(context({ usageData: bare }, { lineLayout, display: { usageCompact } }), 200).join('\n');
      assert.doesNotMatch(text, /5h|7d|Weekly|Fable:? [^5]|Usage|--/, `${lineLayout} usageCompact=${usageCompact}: ${text}`);

      const weekly = plain(context({}, { lineLayout, display: { usageCompact } }), 200).join('\n');
      assert.doesNotMatch(weekly, /5h|--/, `${lineLayout} usageCompact=${usageCompact}: a plan with no 5h window draws none`);
    }
  }
});

test('the tools, agents and todos lines are off until their new keys turn them on', () => {
  const busy = {
    transcript: {
      tools: manyTools(),
      agents: [runningAgent('a1'), runningAgent('a2')],
      todos: [{ content: 'Add tests', status: 'in_progress' }, { content: 'Ship', status: 'pending' }],
    },
  };
  const older = { display: { showTools: true, showAgents: true, showTodos: true } };
  const chosen = { display: { toolsLine: true, agentsLine: true, todosLine: true } };

  for (const lineLayout of ['compact', 'expanded', 'pills']) {
    for (const [name, config] of [['no config', {}], ['the old keys set true', older]]) {
      const text = plain(context(busy, { lineLayout, ...config }), 200).join('\n');
      assert.doesNotMatch(text, /✓ |◐ |▸ |─{5}/, `${lineLayout}, ${name}: ${text}`);
    }
    const shown = plain(context(busy, { lineLayout, ...chosen }), 200).join('\n');
    assert.match(shown, /✓ chrome:browser_batch ×16/, lineLayout);
    assert.match(shown, /◐ Explore \[haiku-4\.5\]: Finding every caller/, lineLayout);
    assert.match(shown, /▸ Add tests \(0\/2\)/, lineLayout);
  }

  for (const key of ['toolsLine', 'agentsLine', 'todosLine']) {
    const only = plain(context(busy, { display: { [key]: true } }), 200).join('\n');
    assert.equal(/✓ chrome/.test(only), key === 'toolsLine', key);
    assert.equal(/◐ Explore/.test(only), key === 'agentsLine', key);
    assert.equal(/▸ Add tests/.test(only), key === 'todosLine', key);
  }
});

test('running agents are a count on the session line while the agents line is off', () => {
  const two = { transcript: { tools: [], agents: [runningAgent('a1'), runningAgent('a2'), { ...runningAgent('a3'), status: 'completed', endTime: new Date() }], todos: [] } };
  const one = { transcript: { tools: [], agents: [runningAgent('a1')], todos: [] } };

  assert.ok(plain(context(two), 200)[0].endsWith('git:(chore/design-sync* !3 ?1) | 2 agents'));
  assert.ok(plain(context(one), 200)[0].endsWith(' | 1 agent'));
  assert.ok(plain(context(two, { lineLayout: 'expanded' }), 200)[0].endsWith('│ 2 agents'));
  assert.doesNotMatch(plain(context(two, { display: { agentsLine: true } }), 200)[0], /agents/, 'the line itself replaces the count');
  assert.doesNotMatch(plain(context(), 200)[0], /agent/);
  assert.equal(plain(context(two), 60)[0], plain(context(), 60)[0], 'the count is the first thing to go');
  assert.ok(plain(context(two), 100)[0].endsWith(' | 2 agents'));
});

test('MCP tool names are shortened to server:tool', () => {
  const cases = [
    ['mcp__claude-in-chrome__browser_batch', 'chrome:browser_batch'],
    ['mcp__claude-in-chrome__computer', 'chrome:computer'],
    ['mcp__plugin_acme_acme__execute_sql', 'acme:execute_sql'],
    ['mcp__plugin_acme_acme-docs__search_documentation', 'acme-docs:search_documentation'],
    ['mcp__plugin_issue_tracker_issue_tracker__list', 'issue_tracker:list'],
    ['mcp__plugin_one_other__run', 'one_other:run'],
    ['mcp__claude_ai_Acme_Drive__search_files', 'Acme_Drive:search_files'],
    ['mcp__linear__get_issue', 'linear:get_issue'],
    ['mcp__server__tool__with__parts', 'server:tool__with__parts'],
    ['Bash', 'Bash'],
    ['mcp__broken', 'mcp__broken'],
  ];
  for (const [name, expected] of cases) {
    assert.equal(compactToolName(name), expected, name);
    assert.equal(shortenToolName(name, 0), expected, name);
  }
  assert.equal(shortenMcpServer('plugin_acme_acme'), 'acme');
  assert.equal(shortenToolName('mcp__plugin_acme_acme__execute_sql', 8), 'execute…', 'an explicit toolNameMaxLength keeps its tool-only form');
});

test('the tools line stays one row: it drops the least used tools and counts them', () => {
  const tools = { transcript: { tools: manyTools(), agents: [], todos: [] } };
  const toolsRow = (columns, display = {}) =>
    plain(context(tools, { display: { toolsLine: true, ...display } }), columns).filter((line) => /✓|◐|more|tools/.test(line));

  assert.deepEqual(toolsRow(200), [
    '◐ acme-docs:search_documentation: .../session-line.ts | ✓ chrome:browser_batch ×16 | ✓ acme:execute_sql ×2 | ✓ Bash ×1 | ✓ chrome:computer ×1 | +3 more',
  ]);
  for (const columns of WIDTHS) {
    for (const display of [{}, { toolsMaxVisible: 0 }, { toolsMaxVisible: 2 }]) {
      const rows = toolsRow(columns, display);
      assert.equal(rows.length, 1, `${columns} columns: ${JSON.stringify(rows)}`);
      assert.ok(cells(rows[0]) <= columns, `${columns} columns: ${rows[0]}`);
      assert.doesNotMatch(rows[0], /mcp__|\|\s*$/, `${columns} columns: ${rows[0]}`);
    }
  }
  assert.equal(toolsRow(100)[0], '◐ acme-docs:search_documentation: .../session-line.ts | ✓ chrome:browser_batch ×16 | +6 more');
  assert.equal(toolsRow(60)[0], '◐ acme-docs:search_documentation | +7 more');
  assert.equal(toolsRow(40)[0], '◐ acme-docs:search_documentation');

  const finished = { transcript: { tools: manyTools().filter((tool) => tool.status === 'completed'), agents: [], todos: [] } };
  const quiet = (columns) => plain(context(finished, { display: { toolsLine: true } }), columns).at(-1);
  assert.equal(quiet(60), '✓ chrome:browser_batch ×16 | ✓ acme:execute_sql ×2 | +5 more');
  assert.equal(quiet(40), '✓ chrome:browser_batch ×16 | +6 more');
  assert.equal(quiet(20), '7 tools');
  assert.equal(toolsRow(20)[0], '8 tools');
});

test('the agents line carries each subagent\'s model, effort, context and worktree, and shortens to fit', () => {
  const agents = [
    runningAgent('a1'),
    runningAgent('a2', { type: 'general-purpose', model: 'sonnet', description: 'Porting the usage row' }),
  ];
  const pillAgents = [
    { id: 'a1', type: 'Explore', model: 'claude-haiku-4-5', modelId: 'claude-haiku-4-5', effort: 'low', tokens: 30_000 },
    {
      id: 'a2',
      type: 'general-purpose',
      model: 'claude-sonnet-5',
      modelId: 'claude-sonnet-5',
      effort: 'high',
      tokens: 50_000,
      window: 1_000_000,
      worktree: '/work/acme-app-export',
      git: { branch: 'feature/export', isDirty: true, ahead: 0, behind: 0 },
    },
  ];
  const ctx = (extra = {}) => context({ transcript: { tools: [], agents, todos: [] }, pillAgents, ...extra }, { display: { agentsLine: true } });
  const rows = (columns, extra) => plain(ctx(extra), columns).filter((line) => line.startsWith('◐'));

  assert.deepEqual(rows(200), [
    '◐ Explore [haiku-4.5 low 30k]: Finding every caller of the billing e... (2m 15s)',
    '◐ general-purpose [sonnet-5 high 5%] wt:(feature/export*): Porting the usage row (2m 15s)',
  ]);
  assert.deepEqual(rows(200, { pillAgents: undefined }), [
    '◐ Explore [haiku-4.5]: Finding every caller of the billing e... (2m 15s)',
    '◐ general-purpose [sonnet]: Porting the usage row (2m 15s)',
  ]);
  for (const columns of WIDTHS) {
    const shown = rows(columns);
    assert.equal(shown.length, 2, `${columns} columns`);
    for (const line of shown) assert.ok(cells(line) <= columns, `${columns} columns: ${line}`);
  }
  assert.deepEqual(rows(60), [
    '◐ Explore [haiku-4.5 low 30k]: Finding every cal... (2m 15s)',
    '◐ general-purpose [sonnet-5 high 5%] (2m 15s)',
  ]);
  assert.deepEqual(rows(40), ['◐ Explore [haiku-4.5 low 30k] (2m 15s)', '◐ general-purpose [sonnet-5] (2m 15s)']);
});

test('the git segment carries the PR and its checks, marks a linked worktree and clips a long branch', () => {
  const pr = { number: 1971, state: 'OPEN', ready: 'clean', base: 'main', checks: { failing: 0, pending: 2, passing: 5 } };
  const prStatus = { version: 1, at: Date.now(), request: 'r', pr };
  const withPr = context({ prStatus });

  assert.ok(plain(withPr, 200)[0].endsWith('acme-app git:(chore/design-sync* !3 ?1) #1971 ● ready ◷ 2 running'));
  const raw = capture(withPr, 200)[0];
  assert.ok(raw.includes(`${GREEN}#1971`) && raw.includes(`${GREEN}● ready`) && raw.includes(`${CYAN}◷ 2 running`));
  assert.equal(plain(withPr, 80)[0], '[Fable 5.2 medium] ██░░░░ 30% | acme-app git:(chore/design-sync*) #1971', 'narrower: the number alone');
  assert.ok(plain(context({ prStatus }, { lineLayout: 'expanded' }), 200)[0].endsWith('acme-app git:(chore/design-sync*) #1971 ● ready ◷ 2 running'));

  const states = [
    [{ ...pr, state: 'MERGED' }, '#1971 ✓ merged', '\x1b[35m#1971'],
    [{ ...pr, state: 'CLOSED' }, '#1971 ✕ closed', `${RED}#1971`],
    [{ ...pr, state: 'DRAFT' }, '#1971 ◌ draft ◷ 2 running', `${DIM}#1971`],
    [{ ...pr, ready: 'conflicts', checks: undefined }, '#1971 ✕ conflicts', `${RED}✕ conflicts`],
    [{ ...pr, ready: 'blocked', checks: { failing: 1, pending: 0, passing: 2 } }, '#1971 ● blocked ✕ 1 failing', `${YELLOW}● blocked`],
  ];
  for (const [state, text, sgr] of states) {
    const line = capture(context({ prStatus: { ...prStatus, pr: state } }), 200)[0];
    assert.ok(strip(line).endsWith(text), `${text}: ${strip(line)}`);
    assert.ok(line.includes(sgr), text);
  }
  const elsewhere = { ...prStatus, own: { branch: 'other', ahead: 0, behind: 0 } };
  assert.doesNotMatch(plain(context({ prStatus: elsewhere }), 200)[0], /#1971/, 'a PR of another branch is not pinned on this checkout');

  const linked = context({ gitStatus: { ...context().gitStatus, isLinked: true } });
  assert.ok(plain(linked, 200)[0].includes('acme-app wt:(chore/design-sync* !3 ?1)'));
  assert.ok(plain({ ...linked, config: mergeConfig({ lineLayout: 'expanded' }) }, 200)[0].includes('acme-app wt:(chore/design-sync*)'));

  const long = (lineLayout, columns) =>
    plain(context({ prStatus, gitStatus: { ...context().gitStatus, branch: LONG_BRANCH, ahead: 2 } }, { lineLayout }), columns);
  assert.ok(long('compact', 200)[0].includes(`git:(${LONG_BRANCH}* ↑2 !3 ?1) #1971 ● ready`));
  for (const columns of WIDTHS) {
    for (const lineLayout of ['compact', 'expanded']) {
      for (const line of long(lineLayout, columns)) assert.ok(cells(line) <= columns, `${lineLayout} ${columns}: ${line}`);
    }
    assert.equal(long('compact', columns).length, 2, `${columns} columns stays two rows`);
  }
  assert.equal(long('compact', 100)[0], '[Fable 5.2 medium] ███░░░░░░░ 30% | acme-app git:(feature/rework-the-billing-export-pipelin…*) #1971');
  assert.equal(cells(long('compact', 100)[0]), 100, 'the branch takes exactly the room that is left');
  assert.equal(long('compact', 60)[0], '[Fable 5.2 medium] ██░░░░ 30% | acme-app git:(feature/rew…*)', 'the PR number goes before the branch does');
  assert.equal(cells(long('compact', 60)[0]), 60);
  assert.equal(long('compact', 40)[0], '[Fable 5.2 medium] █░░░ 30% | acme-app');
  assert.ok(long('expanded', 60).includes('acme-app git:(feature/rework-the-billing-export-pip…*) #1971'));
});

test('every line of a busy session fits the pane at each width, one row per line', () => {
  const now = Date.now();
  const weekly = new Date(now + 3 * DAY);
  const busy = {
    transcript: {
      tools: manyTools(),
      agents: [runningAgent('a1'), runningAgent('a2', { type: 'general-purpose' })],
      todos: [
        { content: 'Rework the billing export pipeline so that large accounts stream instead of buffering', status: 'in_progress' },
        { content: 'Ship', status: 'completed' },
      ],
    },
    gitStatus: { ...context().gitStatus, branch: LONG_BRANCH, ahead: 2, behind: 1 },
    prStatus: { version: 1, at: now, request: 'r', pr: { number: 1971, state: 'OPEN', ready: 'failing', checks: { failing: 0, pending: 3, passing: 1 } } },
    usageData: {
      ...weeklyOnlyUsage(now),
      fiveHour: 16,
      fiveHourResetAt: new Date(now + 2 * HOUR),
      fiveHourSeenAt: new Date(now - 4 * MINUTE),
      sevenDayResetAt: weekly,
    },
    claudeMdCount: 2,
    mcpCount: 5,
    hooksCount: 3,
    authInfo: { method: 'Claude Max 20x', user: null },
  };
  const everything = { display: { toolsLine: true, agentsLine: true, todosLine: true } };

  for (const columns of WIDTHS) {
    const lines = plain(context(busy, everything), columns);
    const label = `${columns} columns: ${JSON.stringify(lines)}`;

    assert.equal(lines.length, 7, label);
    for (const line of lines) assert.ok(cells(line) <= columns, `${cells(line)} cells at ${label}`);
    assert.match(lines[0], columns >= 80 ? /^\[Fable 5\.2 medium \| Max 20x\] / : /^\[Fable 5\.2 medium\] /, label);
    assert.match(lines[1], /~16%.*Fable.*38%.*(Weekly|7d).*~21%/, label);
    assert.match(lines[2], /^─+$/, label);
    assert.match(lines[3], /^◐ acme-docs:search_documentation/, label);
    assert.ok(lines[4].startsWith('◐ Explore') && lines[5].startsWith('◐ general-purpose'), label);
    assert.match(lines[6], /^▸ .*\(1\/2\)$/, label);
    assert.doesNotMatch(lines.join('\n'), /mcp__|\|\s*(\n|$)/, label);

    const expanded = plain(context(busy, { lineLayout: 'expanded', ...everything }), columns);
    for (const line of expanded) assert.ok(cells(line) <= columns, `expanded, ${columns} columns: ${line}`);
    assert.equal(expanded.filter((line) => /^◐|^▸|✓ chrome/.test(line)).length, 4, `expanded, ${columns} columns: one row per activity line`);
  }
});

test('the pills layout needs no Nerd Font unless pillCaps asks for one', () => {
  const git = { worktree: 'acme-app', isLinked: false, branch: 'main', ahead: 0, behind: 0, staged: 0, modified: 2, untracked: 0, conflicts: 0, pr: null };
  const text = (spec) => spec.full.map((seg) => seg.text).join('');

  for (const theme of ['dark', 'light']) {
    const p = paletteFor(theme);
    assert.equal(text(gitSpec(git, p)), ' ▣ acme-app │ ◆ main ~2 ', theme);
    assert.equal(text(gitSpec({ ...git, isLinked: true }, p)), ' ◫ acme-app │ ◆ main ~2 ', theme);
    assert.match(text(gitSpec(git, p, true)), /^  acme-app │  main ~2 $/u, theme);
    assert.match(text(gitSpec({ ...git, isLinked: true }, p, true)), /^  acme-app/u, theme);

    const plainFont = capture(context({ claudeTheme: theme }, { lineLayout: 'pills' }), 200).join('\n');
    assert.doesNotMatch(plainFont, /[-]/u, `${theme}: caps and icons are off by default`);
    assert.ok(strip(plainFont).includes(' ▣ acme-app │ ◆ chore/design-sync ~3 ?1 '), theme);
    const nerdFont = capture(context({ claudeTheme: theme }, { lineLayout: 'pills', display: { pillCaps: true } }), 200).join('\n');
    assert.ok(nerdFont.includes('') && nerdFont.includes('') && nerdFont.includes('') && nerdFont.includes(''), theme);
  }
});

test('every pill segment carries the pill background, in both palettes and at both colour depths', () => {
  for (const theme of ['dark', 'light']) {
    const p = paletteFor(theme);
    const spec = gitSpec({ worktree: 'acme-app', isLinked: false, branch: 'main', ahead: 1, behind: 0, staged: 1, modified: 2, untracked: 3, conflicts: 0, pr: null }, p);
    const background = `\x1b[48;2;${/\((.*)\)/.exec(p.tray.bg)[1].replaceAll(',', ';')}m`;

    for (const caps of [false, true]) {
      const drawn = drawPill(spec, spec.full, p, caps);
      assert.equal(drawn.split(background).length - 1, spec.full.length, `${theme}, caps ${caps}: one background per segment`);
      const body = caps ? drawn.slice(drawn.indexOf('\x1b[0m') + 4, drawn.lastIndexOf('\x1b[38;2;')) : drawn;
      for (const piece of body.split('\x1b[0m')[0].split(/(?=\x1b\[48;2;)/)) {
        assert.ok(piece === '' || piece.startsWith(background), `${theme}: a segment without its background: ${JSON.stringify(piece)}`);
      }
    }

    const indexed = drawPill(spec, spec.full, p, false, '256');
    assert.doesNotMatch(indexed, /\x1b\[[34]8;2;/, `${theme}: no 24-bit colour at 256 colours`);
    assert.equal((indexed.match(/\x1b\[48;5;\d+m/g) ?? []).length, spec.full.length, theme);
  }

  assert.equal(colorDepthFor({ TERM_PROGRAM: 'Apple_Terminal' }), '256');
  assert.equal(colorDepthFor({ TERM_PROGRAM: 'Apple_Terminal', COLORTERM: 'truecolor' }), 'truecolor');
  assert.equal(colorDepthFor({ TERM_PROGRAM: 'iTerm.app' }), 'truecolor');
  assert.equal(colorDepthFor({}), 'truecolor');
  assert.equal(to256(0, 0, 0), 16);
  assert.equal(to256(255, 255, 255), 231);
  assert.equal(to256(34, 34, 34), 235);
  assert.equal(to256(255, 0, 0), 196);

  const rows = renderPillBand(
    { context: null, model: { name: 'Fable 5.2', effort: null }, fiveHour: null, sevenDay: null, git: null, folder: 'acme-app', agents: [] },
    200,
    { palette: paletteFor('dark'), caps: false, now: Date.now(), depth: '256' },
  );
  assert.doesNotMatch(rows.join('\n'), /\x1b\[[34]8;2;/);
});
