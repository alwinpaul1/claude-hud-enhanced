import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The shipped version lives in files that no compiler compares. When they
// disagree, `/plugin update` is what breaks: a client compares the version it
// resolves against the installed one, so a stale number makes the update a
// silent no-op — the user runs it, it reports success, and they keep running
// the old code. That is indistinguishable from "the fix didn't work".
//
// Note on marketplace.json: the entry under `plugins[]` carries NO version.
// The plugin's version is resolved from its own .claude-plugin/plugin.json via
// the entry's `source`. `metadata.version` is the *marketplace's* own version,
// which this repo keeps in step with the single plugin it ships.
const pkgUrl = new URL('../package.json', import.meta.url);
const pluginUrl = new URL('../.claude-plugin/plugin.json', import.meta.url);
const lockUrl = new URL('../package-lock.json', import.meta.url);
const marketplaceUrl = new URL('../../../.claude-plugin/marketplace.json', import.meta.url);

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'));

test('package.json and plugin.json ship the same version', async () => {
  const [pkg, plugin] = await Promise.all([readJson(pkgUrl), readJson(pluginUrl)]);

  assert.equal(
    pkg.version,
    plugin.version,
    `package.json (${pkg.version}) and plugin.json (${plugin.version}) disagree`,
  );
});

test('package-lock.json tracks package.json', async () => {
  // The lock silently sat at 0.7.0 across the 0.7.1, 0.7.2 and 0.7.3 releases:
  // `npm version` updates it, a hand-edited package.json does not, and nothing
  // compared them. Nothing breaks loudly, which is exactly why it drifted.
  const [pkg, lock] = await Promise.all([readJson(pkgUrl), readJson(lockUrl)]);

  assert.equal(lock.version, pkg.version, `package-lock.json (${lock.version}) trails package.json (${pkg.version})`);
  assert.equal(
    lock.packages?.['']?.version,
    pkg.version,
    `package-lock.json root package entry (${lock.packages?.['']?.version}) trails package.json (${pkg.version})`,
  );
});

test('marketplace metadata tracks the plugin version', async () => {
  const [plugin, marketplace] = await Promise.all([readJson(pluginUrl), readJson(marketplaceUrl)]);

  assert.equal(
    marketplace.metadata?.version,
    plugin.version,
    `marketplace metadata.version (${marketplace.metadata?.version}) trails plugin.json (${plugin.version})`,
  );
});

test('the marketplace entry resolves to the plugin directory this version lives in', async () => {
  const marketplace = await readJson(marketplaceUrl);
  const entry = marketplace.plugins?.find((p) => p.name === 'claude-hud-enhanced');

  assert.ok(entry, 'marketplace.json must list a claude-hud-enhanced plugin entry');
  assert.equal(entry.source, './plugins/claude-hud-enhanced');

  // If the entry ever gains its own version field it becomes a fourth home, and
  // a stale one there is exactly what makes /plugin update do nothing.
  if (entry.version !== undefined) {
    const plugin = await readJson(pluginUrl);
    assert.equal(entry.version, plugin.version, 'marketplace plugin entry version trails plugin.json');
  }
});

test('the version is a plain semver triple', async () => {
  const plugin = await readJson(pluginUrl);

  assert.match(plugin.version, /^\d+\.\d+\.\d+$/, 'plugin version must be MAJOR.MINOR.PATCH');
});

test('the CHANGELOG documents the version being shipped', async () => {
  const plugin = await readJson(pluginUrl);
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

  assert.ok(
    changelog.includes(`## [${plugin.version}]`),
    `CHANGELOG.md has no entry for ${plugin.version} — a release nobody can read is a release nobody trusts`,
  );
});
