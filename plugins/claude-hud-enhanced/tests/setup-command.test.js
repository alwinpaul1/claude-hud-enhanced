import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const setupUrl = new URL('../commands/setup.md', import.meta.url);
const readSetup = () => readFile(setupUrl, 'utf8');

// The awk program the generated statusline command relies on to pull the version
// directory out of the cache glob. Kept as one literal so these tests and
// setup.md cannot drift apart silently.
const AWK_PROGRAM = '{ print $(NF-1) "\\t" $(0) }';
const GREP_PATTERN = '^[0-9]+\\.[0-9]+\\.[0-9]+[[:space:]]';
const SAMPLE_GLOB_LINE = '/Users/x/.claude/plugins/cache/claude-hud-enhanced/claude-hud-enhanced/0.7.2/';

const runAwk = (program, input) =>
  execFileSync('awk', ['-F/', program], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

test('setup commands silence /dev/tty failures before opening the device', async () => {
  const setup = await readSetup();

  assert.doesNotMatch(setup, /stty size <\/dev\/tty 2>\/dev\/null/);
  assert.equal(setup.match(/stty size 2>\/dev\/null <\/dev\/tty/g)?.length, 3);
});

// --- The escaping bug that shipped a silently dead statusline -----------------
//
// setup.md used to tell the agent the saved settings.json "should contain
// \\$(NF-1) and \\$0". Decoded from JSON that is \$(NF-1); awk rejects it as a
// syntax error, plugin_dir resolves empty, and the runtime exits with
// "Module not found". Claude Code discards statusline stderr, so the only
// symptom is a HUD that never appears — after setup reported success.

test('setup.md never instructs a backslash before $ in the awk fragment', async () => {
  const setup = await readSetup();

  // The old wrong instruction, in its JSON-doubled form. This must never return.
  assert.ok(
    !setup.includes('\\\\$(NF-1)') && !setup.includes('\\\\$0'),
    'setup.md must not tell the agent that settings.json should contain \\\\$(NF-1) or \\\\$0',
  );

  // The single-backslash form may appear ONLY as the labelled counter-example.
  // Anywhere else it reads as an instruction and kills the HUD silently.
  const offenders = setup
    .split('\n')
    .filter((line) => line.includes('\\$(NF-1)') || line.includes('\\$0'))
    .filter((line) => !line.includes('syntax error'));

  assert.deepEqual(offenders, [], 'backslash-dollar may only appear on the line showing awk rejecting it');
});

test('the awk fragment setup.md documents actually parses and picks the version dir', () => {
  const out = runAwk(AWK_PROGRAM, `${SAMPLE_GLOB_LINE}\n`);

  assert.equal(out, `0.7.2\t${SAMPLE_GLOB_LINE}\n`);
});

test('MUTATION: the backslashed awk fragment must fail, or this suite proves nothing', () => {
  // Guards the guard. If awk ever accepted \$(NF-1), every assertion above would
  // pass against a broken command and this file would be decoration.
  assert.throws(
    () => runAwk('{ print \\$(NF-1) "\\t" \\$0 }', `${SAMPLE_GLOB_LINE}\n`),
    'awk must reject \\$(NF-1); if it does not, the escaping tests above cannot fail',
  );
});

test('every awk fragment in setup.md is one of the two unescaped forms', async () => {
  const setup = await readSetup();
  const fragments = setup.match(/\{ print \$\(NF-1\)[^}]*\}/g) ?? [];

  // Two legitimate shapes: the statusline lookup, which emits "<version>\t<path>",
  // and the Step -1 staleness check, which needs the version alone. Anything else
  // — a backslashed $ above all — is the bug this file exists to catch.
  const VERSION_ONLY = '{ print $(NF-1) }';

  assert.ok(fragments.length >= 4, `expected the awk fragments in setup.md, found ${fragments.length}`);
  assert.ok(fragments.includes(AWK_PROGRAM), 'the tab-emitting fragment must be present');
  assert.ok(fragments.includes(VERSION_ONLY), 'the Step -1 version-only fragment must be present');

  for (const fragment of fragments) {
    assert.ok(
      fragment === AWK_PROGRAM || fragment === VERSION_ONLY,
      `unrecognised awk fragment in setup.md: ${fragment}`,
    );
  }
});

test('the generated command survives a JSON round trip byte for byte', async () => {
  const setup = await readSetup();
  const commands = setup.match(/bash -c 'cols=\$\{COLUMNS:-\}.*?'\n/g) ?? [];

  assert.ok(commands.length >= 2, `expected the bun and node commands, found ${commands.length}`);

  for (const command of commands) {
    const roundTripped = JSON.parse(JSON.stringify({ command })).command;
    assert.equal(roundTripped, command, 'JSON encoding must not alter the statusline command');
    assert.ok(roundTripped.includes(AWK_PROGRAM), 'awk fragment must survive JSON encoding intact');
    assert.ok(!roundTripped.includes('\\$'), 'no backslash-dollar may appear after a JSON round trip');
  }
});

test('the documented grep pattern matches real awk output on this platform', () => {
  const awkOut = runAwk(AWK_PROGRAM, `${SAMPLE_GLOB_LINE}\n`);

  const matched = execFileSync('grep', ['-E', GREP_PATTERN], { input: awkOut, encoding: 'utf8' });
  assert.equal(matched, awkOut, '[[:space:]] must match the tab awk emits');
});

test('setup.md pins the grep separator as [[:space:]], never a bare \\t', async () => {
  const setup = await readSetup();

  // GNU grep (Linux) does NOT expand \t in an ERE — it warns "stray \ before t"
  // and matches a literal 't', so the version lookup silently returns nothing.
  // macOS /usr/bin/grep DOES expand it, which is why this cannot be asserted by
  // running grep: the hazard is invisible on the maintainer's own machine. Pin
  // the documented pattern instead, which is platform-independent.
  const versionPatterns = setup.match(/\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+[^']*/g) ?? [];

  // Two shapes again. The statusline lookup matches "<version>\t<path>" and so
  // must use [[:space:]]. The Step -1 check matches a bare version and anchors
  // with $, where no separator is involved at all.
  const VERSION_ONLY_PATTERN = '^[0-9]+\\.[0-9]+\\.[0-9]+$';

  assert.ok(versionPatterns.length >= 4, `expected the version grep patterns, found ${versionPatterns.length}`);
  for (const pattern of versionPatterns) {
    assert.ok(
      pattern.startsWith(GREP_PATTERN) || pattern === VERSION_ONLY_PATTERN,
      `grep pattern must use [[:space:]] or anchor with $, got: ${pattern}`,
    );
  }
});

test('setup.md verifies the command it wrote to disk, not the one it composed', async () => {
  const setup = await readSetup();

  assert.match(setup, /## Step 3\.5:/, 'setup.md must carry the post-write verification step');
  assert.match(setup, /statusLine\.command/, 'Step 3.5 must read statusLine.command back out of settings.json');
  assert.ok(
    setup.includes('stdout is the only thing that counts'),
    'Step 3.5 must state that empty stdout is a failed setup regardless of exit code',
  );
});

// --- Docs must not contradict the restart requirement ------------------------

test('no doc claims the HUD appears without a restart', async () => {
  const urls = [
    new URL('../../../README.md', import.meta.url),
    new URL('../../../CLAUDE.README.md', import.meta.url),
  ];

  assert.equal(urls.filter((url) => existsSync(url)).length, 2, 'both READMEs must be reachable from the plugin dir');

  for (const url of urls) {
    const text = await readFile(url, 'utf8');
    assert.ok(!/no restart needed/i.test(text), `${url.pathname} still claims no restart is needed`);
    assert.ok(/restart claude code/i.test(text), `${url.pathname} must tell the user to restart Claude Code`);
  }
});

test('setup.md still requires a restart before declaring success', async () => {
  const setup = await readSetup();

  assert.match(setup, /Please restart Claude Code now/);
  assert.match(setup, /cannot appear in the same session where setup was run/);
});

// --- The stale-command trap ---------------------------------------------------
//
// /plugin update replaces files on disk, but a running session keeps the slash
// command it loaded at startup. Setup run immediately after an update therefore
// executes the OLD instructions against the NEW plugin, reinstating whatever bug
// the update fixed. Observed live on 2026-09-01: a session on 0.7.4 invoked setup
// and got the pre-fix Step 3 text with no Step 3.5.

test('setup carries its own version, and it matches plugin.json', async () => {
  // Two truths in two languages that no compiler compares. A bump that forgets
  // the comment would ship a staleness guard that always reports "current".
  const setup = await readSetup();
  const plugin = JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));

  const embedded = /<!-- SETUP_COMMAND_VERSION: (\d+\.\d+\.\d+) -->/.exec(setup)?.[1];
  assert.ok(embedded, 'setup.md must carry a SETUP_COMMAND_VERSION comment');
  assert.equal(embedded, plugin.version, 'SETUP_COMMAND_VERSION must track plugin.json');

  // The version is also stated in prose and used in the stop condition; every
  // mention must move together or the guard compares against a stale literal.
  const mentions = setup.match(/`\d+\.\d+\.\d+`/g) ?? [];
  const versionLike = mentions.filter((m) => /^`\d+\.\d+\.\d+`$/.test(m));
  assert.ok(versionLike.length >= 2, 'setup.md must state its version in prose as well as the comment');
  for (const m of versionLike) {
    assert.equal(m, `\`${plugin.version}\``, `stale version literal in setup.md: ${m}`);
  }
});

test('the staleness guard runs before any settings.json write', async () => {
  const setup = await readSetup();

  const guardAt = setup.indexOf('## Step -1:');
  const ghostAt = setup.indexOf('## Step 0:');
  const applyAt = setup.indexOf('## Step 3: Apply Configuration');

  assert.ok(guardAt > -1, 'setup.md must carry the Step -1 staleness guard');
  assert.ok(guardAt < ghostAt, 'the staleness guard must run before Step 0');
  assert.ok(guardAt < applyAt, 'the staleness guard must run before the config is written');
  assert.match(setup.slice(guardAt, ghostAt), /STOP/, 'a stale command must stop, not warn and continue');
  assert.match(setup.slice(guardAt, ghostAt), /reload-plugins/, 'the guard must name the fix');
});

test('the README upgrade path reloads before running setup', async () => {
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');

  const update = readme.indexOf('/plugin update claude-hud-enhanced');
  const reload = readme.indexOf('/reload-plugins');
  const setupCmd = readme.indexOf('/claude-hud-enhanced:setup', update);

  assert.ok(update > -1 && reload > -1 && setupCmd > -1, 'README must document all three upgrade commands');
  assert.ok(update < reload, 'update must come before reload');
  assert.ok(reload < setupCmd, 'reload must come before setup, or setup runs the stale command');
});
