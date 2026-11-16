import { testRoot } from './isolate-env.mjs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const pluginRoot = fileURLToPath(new URL('../../', import.meta.url));
export const packageVersion = JSON.parse(readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version;
export const isPosix = process.platform !== 'win32';

const ANSI = /\x1b\[[0-9;]*m/g;
export const strip = (text) => text.replace(ANSI, '');
export const LIGHT_BLUE_BG = '\x1b[48;2;226;230;250m';
export const DARK_BLUE_BG = '\x1b[48;2;40;46;80m';
export const CAP_LEFT = '';
export const CAP_RIGHT = '';

const shortTmpDirs = [];
process.on('exit', () => {
  for (const dir of shortTmpDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

export function createWorld(label = 'world') {
  const root = realpathSync(mkdtempSync(path.join(testRoot, `${label}-`)));
  const home = path.join(root, 'home');
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'h-')));
  shortTmpDirs.push(tmp);
  mkdirSync(home, { recursive: true });
  const profile = (name, dirName, usesEnv) => {
    const configDir = path.join(home, dirName);
    mkdirSync(configDir, { recursive: true });
    return {
      name,
      configDir,
      env: usesEnv ? { CLAUDE_CONFIG_DIR: configDir } : {},
      dataDir: path.join(configDir, 'plugins', 'claude-hud-enhanced'),
      legacyDataDir: path.join(configDir, 'plugins', 'claude-hud'),
      settingsPath: path.join(configDir, 'settings.json'),
      cacheDir: path.join(configDir, 'plugins', 'cache'),
    };
  };

  return {
    root,
    home,
    tmp,
    profiles: { default: profile('default', '.claude', false), work: profile('work', '.claude-work', true) },
    cleanup: () => {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

export function writeSettings(profile, settings) {
  const current = existsSync(profile.settingsPath) ? JSON.parse(readFileSync(profile.settingsPath, 'utf8')) : {};
  writeJson(profile.settingsPath, { ...current, ...settings });
}

export const readSettings = (profile) => JSON.parse(readFileSync(profile.settingsPath, 'utf8'));

export function writeAccount(world, profile) {
  const account = {
    accountUuid: '00000000-0000-4000-8000-000000000001',
    emailAddress: `${profile.name}@example.invalid`,
    organizationUuid: '00000000-0000-4000-8000-000000000002',
    organizationName: 'Example Org',
    organizationType: 'claude_max',
    organizationRateLimitTier: 'default_claude_max_20x',
    userRateLimitTier: 'default_claude_max_20x',
    displayName: 'Test User',
    billingType: 'stripe_subscription',
  };
  if (profile.name === 'default') {
    writeJson(path.join(profile.configDir, '.claude.json'), { migrationVersion: 1 });
    writeJson(`${profile.configDir}.json`, { oauthAccount: account });
  } else {
    writeJson(path.join(profile.configDir, '.claude.json'), { oauthAccount: account });
  }
}

let templateDir = null;

function pluginTemplate() {
  if (templateDir) return templateDir;
  const dir = path.join(realpathSync(testRoot), 'plugin-template');
  mkdirSync(dir, { recursive: true });
  for (const entry of ['dist', 'src', 'commands', '.claude-plugin', 'package.json']) {
    const from = path.join(pluginRoot, entry);
    if (existsSync(from)) cpSync(from, path.join(dir, entry), { recursive: true });
  }
  templateDir = dir;
  return dir;
}

export function installPlugin(profile, options = {}) {
  const marketplace = options.marketplace ?? 'claude-hud-enhanced';
  const real = options.real ?? '0.10.0';
  const stubs = options.stubs ?? ['0.8.3', '0.9.0'];
  const base = path.join(profile.cacheDir, marketplace, 'claude-hud-enhanced');
  const realDir = path.join(base, real);
  mkdirSync(base, { recursive: true });
  if (options.copy) cpSync(pluginTemplate(), realDir, { recursive: true });
  else symlinkSync(pluginTemplate(), realDir, 'dir');
  for (const version of stubs) {
    const dir = path.join(base, version);
    mkdirSync(path.join(dir, 'dist'), { recursive: true });
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'dist', 'index.js'), `console.log('STALE BUILD ${version}');\n`);
    writeFileSync(path.join(dir, 'src', 'index.ts'), `console.log('STALE BUILD ${version}');\n`);
    writeJson(path.join(dir, 'package.json'), { name: 'claude-hud-enhanced', version, type: 'module' });
  }
  mkdirSync(path.join(base, 'not-a-version'), { recursive: true });
  writeJson(path.join(profile.configDir, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { [`claude-hud-enhanced@${marketplace}`]: [{ scope: 'user', installPath: realDir, version: real }] },
  });

  return realDir;
}

export function setupCommand(runtime, runtimePath) {
  const setup = readFileSync(path.join(pluginRoot, 'commands', 'setup.md'), 'utf8');
  const heading = runtime === 'bun' ? '**When runtime is bun**' : '**When runtime is node**';
  const after = setup.slice(setup.indexOf(heading));
  const block = /```\n\s*(bash -c '[^\n]+)\n\s*```/.exec(after);
  if (!block) throw new Error(`setup.md has no ${runtime} command block`);

  return block[1]
    .replace('{RUNTIME_PATH}', runtimePath)
    .replace('{SOURCE}', runtime === 'bun' ? 'src/index.ts' : 'dist/index.js');
}

export function applySetup(profile, command, refreshInterval = 5) {
  writeSettings(profile, { statusLine: { type: 'command', command, refreshInterval } });
}

export function findRuntime(name) {
  if (name === 'node') return process.execPath;
  const found = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  const resolved = found.status === 0 ? found.stdout.trim() : '';
  return resolved || null;
}

export function toolBin(world, tools, label = 'bin') {
  const dir = path.join(world.root, label);
  mkdirSync(dir, { recursive: true });
  for (const tool of tools) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
    const target = found.stdout.trim();
    if (found.status === 0 && target.startsWith('/') && !existsSync(path.join(dir, tool))) {
      symlinkSync(target, path.join(dir, tool));
    }
  }
  return dir;
}

export const LAUNCHER_TOOLS = ['sh', 'bash', 'ls', 'awk', 'grep', 'sort', 'tail', 'cut', 'stty', 'cat', 'env', 'uname', 'sed', 'tr', 'dirname', 'basename', 'ps'];

export function writeGhStub(world, responses = {}, label = 'gh-bin') {
  const dir = path.join(world.root, label);
  const log = path.join(dir, 'calls.log');
  mkdirSync(dir, { recursive: true });
  const file = (name, value) => {
    const target = path.join(dir, name);
    writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
    return target;
  };
  const view = responses.view ? file('view.json', responses.view) : null;
  const pull = responses.pull ? file('pull.json', responses.pull) : null;
  const checks = responses.checks ? file('checks.json', responses.checks) : null;
  const script = [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> '${log}'`,
    'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
    view ? `  cat '${view}'; exit 0` : '  echo "no pull requests found" >&2; exit 1',
    'fi',
    'if [ "$1" = "api" ]; then',
    '  case "$2" in',
    checks
      ? `    *check-runs*) printf 'HTTP/2.0 200 OK\\r\\nEtag: "checks-1"\\r\\n\\r\\n'; cat '${checks}'; exit 0;;`
      : '    *check-runs*) exit 1;;',
    pull
      ? `    *pulls*) printf 'HTTP/2.0 200 OK\\r\\nEtag: "pull-1"\\r\\n\\r\\n'; cat '${pull}'; exit 0;;`
      : '    *pulls*) exit 1;;',
    '  esac',
    'fi',
    'exit 1',
    '',
  ].join('\n');
  writeFileSync(path.join(dir, 'gh'), script);
  chmodSync(path.join(dir, 'gh'), 0o755);

  return { dir, log, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
}

const gitEnv = (world) => ({
  ...process.env,
  HOME: world.home,
  GIT_CONFIG_GLOBAL: path.join(world.root, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
});

export function git(world, cwd, ...args) {
  return execFileSync('git', args, { cwd, env: gitEnv(world), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function createRepo(world, name = 'acme-app') {
  writeFileSync(
    path.join(world.root, 'gitconfig'),
    '[user]\n\tname = HUD Test\n\temail = hud-test@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n',
  );
  const remote = path.join(world.root, 'remotes', `${name}.git`);
  const repo = path.join(world.root, 'code', name);
  const other = path.join(world.root, 'code', `${name}-other`);
  const worktree = path.join(world.root, 'code', `${name}-feature`);
  mkdirSync(path.dirname(remote), { recursive: true });
  mkdirSync(path.dirname(repo), { recursive: true });
  git(world, world.root, 'init', '--bare', '--initial-branch=main', remote);
  git(world, world.root, 'clone', '--quiet', remote, repo);
  const commit = (dir, file, text, message) => {
    writeFileSync(path.join(dir, file), text);
    git(world, dir, 'add', file);
    git(world, dir, 'commit', '--quiet', '-m', message);
  };
  commit(repo, 'README.md', '# acme\n', 'initial');
  commit(repo, 'app.txt', 'one\n', 'app');
  git(world, repo, 'push', '--quiet', '-u', 'origin', 'main');
  git(world, world.root, 'clone', '--quiet', remote, other);
  commit(other, 'remote.txt', 'remote\n', 'remote change');
  git(world, other, 'push', '--quiet', 'origin', 'main');
  commit(repo, 'local-1.txt', 'a\n', 'local one');
  commit(repo, 'local-2.txt', 'b\n', 'local two');
  git(world, repo, 'fetch', '--quiet', 'origin');
  writeFileSync(path.join(repo, 'app.txt'), 'one\nedited\n');
  writeFileSync(path.join(repo, 'staged.txt'), 'staged\n');
  git(world, repo, 'add', 'staged.txt');
  writeFileSync(path.join(repo, 'untracked-1.txt'), 'u\n');
  writeFileSync(path.join(repo, 'untracked-2.txt'), 'u\n');
  git(world, repo, 'worktree', 'add', '--quiet', '-b', 'feature/pills', worktree, 'origin/main');
  writeFileSync(path.join(worktree, 'wip.txt'), 'wip\n');

  return { remote, repo, other, worktree, name };
}

export function writeTranscript(world, options = {}) {
  const sessionId = options.sessionId ?? '11111111-2222-4333-8444-555555555555';
  const dir = path.join(world.root, 'projects', options.project ?? 'acme');
  const transcriptPath = path.join(dir, `${sessionId}.jsonl`);
  mkdirSync(dir, { recursive: true });
  const at = (seconds) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  const lines = [
    { type: 'user', timestamp: at(0), message: { role: 'user', content: 'ship the pill row' } },
    {
      type: 'assistant',
      timestamp: at(1),
      message: {
        id: 'msg_1',
        role: 'assistant',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 40000, cache_creation_input_tokens: 500 },
        content: [{ type: 'tool_use', id: 'toolu_read_1', name: 'Read', input: { file_path: '/tmp/example.ts' } }],
      },
    },
    {
      type: 'user',
      timestamp: at(2),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_read_1', is_error: false }] },
    },
    ...(options.prCommand
      ? [
          {
            type: 'assistant',
            timestamp: at(3),
            message: {
              id: 'msg_2',
              role: 'assistant',
              content: [{ type: 'tool_use', id: 'toolu_bash_1', name: 'Bash', input: { command: options.prCommand.command } }],
            },
          },
          {
            type: 'user',
            timestamp: at(4),
            toolUseResult: { stdout: options.prCommand.stdout },
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash_1', is_error: false }] },
          },
        ]
      : []),
    ...(options.agents ?? []).map((agent, index) => ({
      type: 'assistant',
      timestamp: at(5 + index),
      message: {
        id: `msg_agent_${index}`,
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: agent.toolUseId,
            name: agent.tool ?? 'Agent',
            input: { subagent_type: agent.type, description: agent.description ?? 'Explore the repo', prompt: 'look around' },
          },
        ],
      },
    })),
  ];
  writeFileSync(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const subagents = path.join(dir, sessionId, 'subagents');
  for (const agent of options.agents ?? []) {
    if (agent.meta === false) continue;
    mkdirSync(subagents, { recursive: true });
    writeJson(path.join(subagents, `agent-${agent.id}.meta.json`), {
      toolUseId: agent.toolUseId,
      agentType: agent.type,
      ...(agent.worktreePath ? { worktreePath: agent.worktreePath } : {}),
    });
    const usage = { input_tokens: 2000, cache_read_input_tokens: agent.tokens - 2000, cache_creation_input_tokens: 0, output_tokens: 10 };
    writeFileSync(
      path.join(subagents, `agent-${agent.id}.jsonl`),
      `${JSON.stringify({ type: "assistant", effort: agent.effort, message: { model: agent.modelId, usage } })}\n`,
    );
  }

  return { transcriptPath, sessionId, subagentsDir: subagents };
}

export function stdinFor(options = {}) {
  const now = options.now ?? Date.now();
  return {
    session_id: options.sessionId ?? '11111111-2222-4333-8444-555555555555',
    transcript_path: options.transcriptPath ?? '',
    cwd: options.cwd,
    workspace: { current_dir: options.cwd, project_dir: options.cwd },
    model: { id: 'claude-opus-5-5[1m]', display_name: 'Opus 5.5 (1M context)' },
    effort: { level: 'medium' },
    version: '2.1.200',
    context_window: {
      context_window_size: 1_000_000,
      used_percentage: 7,
      remaining_percentage: 93,
      current_usage: { input_tokens: 9000, output_tokens: 500, cache_creation_input_tokens: 10000, cache_read_input_tokens: 50000 },
    },
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: Math.floor((now + 2 * 3_600_000) / 1000) },
      seven_day: { used_percentage: 8, resets_at: Math.floor((now + 3 * 24 * 3_600_000) / 1000) },
    },
    ...options.extra,
  };
}

function statuslineInvocation(world, profile, stdin, options) {
  const command = options.command ?? readSettings(profile).statusLine.command;
  const script = path.join(world.tmp, `statusline-${profile.name}.sh`);
  writeFileSync(script, `${command}\n`);
  const basePath = options.path ?? process.env.PATH ?? '';
  const env = {
    ...process.env,
    HOME: world.home,
    USERPROFILE: world.home,
    TMPDIR: world.tmp,
    TZ: 'UTC',
    PATH: options.ghDir ? `${options.ghDir}${path.delimiter}${basePath}` : basePath,
    ...profile.env,
    ...options.env,
  };
  delete env.COLUMNS;
  if (!('CLAUDE_CONFIG_DIR' in profile.env) && !options.env?.CLAUDE_CONFIG_DIR) delete env.CLAUDE_CONFIG_DIR;
  if (options.columns !== undefined) env.COLUMNS = String(options.columns);
  const input = stdin === null ? '' : typeof stdin === 'string' ? stdin : JSON.stringify(stdin);

  return { script, env, input };
}

function describeRun(status, signal, stdout, stderr, started) {
  return {
    status,
    signal,
    stdout,
    stderr,
    lines: stdout.split('\n').filter((line) => line.length > 0),
    plain: strip(stdout),
    plainLines: strip(stdout).split('\n').filter((line) => line.length > 0),
    pillLines: stdout.split('\n').filter((line) => line.includes('\x1b[48;2;')),
    ms: Date.now() - started,
  };
}

const GIT_SHOWN = /(^|[ (])(main|feature\/pills)[ *)]/m;

function runOnce(world, profile, stdin, options) {
  const { script, env, input } = statuslineInvocation(world, profile, stdin, options);
  const started = Date.now();
  const result = spawnSync('sh', [script], { input, env, encoding: 'utf8', timeout: options.timeoutMs ?? 30_000 });

  return describeRun(result.status, result.signal, result.stdout ?? '', result.stderr ?? '', started);
}

export function runStatusline(world, profile, stdin, options = {}) {
  const inRepo = stdin !== null && typeof stdin === 'object' && typeof stdin.cwd === 'string' && existsSync(path.join(stdin.cwd, '.git'));
  const isWide = (options.columns ?? 120) >= 100;
  const settled =
    options.settled === false
      ? null
      : (options.settled ?? (inRepo && isWide && options.path === undefined ? (run) => GIT_SHOWN.test(run.plain) : null));
  let run = runOnce(world, profile, stdin, options);
  for (let attempt = 0; settled && !settled(run) && attempt < 5; attempt++) {
    spawnSync('sleep', ['1.2']);
    run = runOnce(world, profile, stdin, options);
  }

  return run;
}

export function runStatuslineAsync(world, profile, stdin, options = {}) {
  const { script, env, input } = statuslineInvocation(world, profile, stdin, options);
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn('sh', [script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 20_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve(describeRun(status, signal, stdout, stderr, started));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

export const repoRoot = path.resolve(pluginRoot, '..', '..');

export function hasReleaseTag(tag) {
  const probe = spawnSync('git', ['-C', repoRoot, 'cat-file', '-e', `${tag}:plugins/claude-hud-enhanced/dist/index.js`], {
    stdio: 'ignore',
  });
  return probe.status === 0;
}

export function installReleasedBuild(profile, tag, options = {}) {
  const version = tag.replace(/^v/, '');
  const marketplace = options.marketplace ?? 'claude-hud-enhanced';
  const dir = path.join(profile.cacheDir, marketplace, options.pluginName ?? 'claude-hud-enhanced', version);
  mkdirSync(dir, { recursive: true });
  const archive = spawnSync(
    'sh',
    [
      '-c',
      'git -C "$1" archive "$2" plugins/claude-hud-enhanced/dist plugins/claude-hud-enhanced/package.json | tar -x -C "$3" --strip-components=2',
      'sh',
      repoRoot,
      tag,
      dir,
    ],
    { encoding: 'utf8' },
  );
  if (archive.status !== 0 || !existsSync(path.join(dir, 'dist', 'index.js'))) {
    throw new Error(`could not extract ${tag}: ${archive.stderr}`);
  }

  return dir;
}

export function resolveInProfile(world, profile, expression) {
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `const m = await import(${JSON.stringify(new URL('../../dist/daemon-ipc.js', import.meta.url).href)}); process.stdout.write(String(${expression}));`],
    { env: { ...process.env, HOME: world.home, USERPROFILE: world.home, TMPDIR: world.tmp, ...profile.env, ...(profile.env.CLAUDE_CONFIG_DIR ? {} : { CLAUDE_CONFIG_DIR: '' }) }, encoding: 'utf8' },
  );
  return out;
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopDaemon(profile) {
  const pidFile = path.join(profile.dataDir, 'daemon', 'hud.pid');
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 1 && isAlive(pid)) process.kill(pid, 'SIGTERM');
}

export async function waitFor(probe, timeoutMs = 15_000, everyMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

export const listDir = (dir) => (existsSync(dir) ? readdirSync(dir).sort() : []);

export function visibleWidth(line) {
  return [...strip(line)].length;
}
