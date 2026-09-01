import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  checkTagMatchesVersion,
  checkVersionNotAlreadyReleased,
  parseTagVersion,
} from '../scripts/check-release-tag.mjs';

test('parseTagVersion accepts vMAJOR.MINOR.PATCH and nothing else', () => {
  assert.equal(parseTagVersion('v0.7.4'), '0.7.4');
  assert.equal(parseTagVersion('v10.20.30'), '10.20.30');

  for (const bad of ['0.7.4', 'v0.7', 'v0.7.4-rc1', 'release-0.7.4', '', undefined, null]) {
    assert.equal(parseTagVersion(bad), null, `${JSON.stringify(bad)} must not parse as a release tag`);
  }
});

test('a tag must ship the version plugin.json declares', () => {
  assert.deepEqual(checkTagMatchesVersion('v0.7.4', '0.7.4'), { ok: true, version: '0.7.4' });

  // The shape nothing checked: a tag naming a version the tree does not declare.
  const mismatch = checkTagMatchesVersion('v0.9.9', '0.7.4');
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.reason, /ships version 0\.9\.9.*declares 0\.7\.4/);

  const malformed = checkTagMatchesVersion('0.7.4', '0.7.4');
  assert.equal(malformed.ok, false);
  assert.match(malformed.reason, /vMAJOR\.MINOR\.PATCH/);
});

test('a version that already has a release may not be re-cut', () => {
  // This is the 2026-09-01 bug: v0.7.3 was force-moved across three trees, each
  // one live on the default branch under the same version string.
  const released = ['v0.7.3', 'v0.7.2', 'v0.7.0'];

  const reused = checkVersionNotAlreadyReleased('0.7.3', released);
  assert.equal(reused.ok, false);
  assert.match(reused.reason, /already has a published release/);
  assert.match(reused.reason, /Bump the version instead/);

  assert.deepEqual(checkVersionNotAlreadyReleased('0.7.4', released), { ok: true });
});

test('the guard runs before build and test in the Release workflow', async () => {
  // Order matters: running it after `npm test` means a red suite masks a version
  // reuse, which is exactly the sequence that produced the bug.
  const workflow = await readFile(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8');

  const guardAt = workflow.indexOf('check-release-tag.mjs');
  const buildAt = workflow.indexOf('npm run build');
  const releaseAt = workflow.indexOf('action-gh-release');

  assert.ok(guardAt > -1, 'release.yml must run the release guard');
  assert.ok(buildAt > -1 && guardAt < buildAt, 'the guard must run before build');
  assert.ok(releaseAt > -1 && guardAt < releaseAt, 'the guard must run before the release is created');
});

test('the guard fails loudly rather than skipping when it cannot verify', async () => {
  // A guard that passes when it cannot check is worse than no guard: it reports
  // an invariant it never tested.
  const source = await readFile(new URL('../scripts/check-release-tag.mjs', import.meta.url), 'utf8');

  const catchBlock = source.slice(source.indexOf('} catch (err) {'));
  assert.match(catchBlock, /process\.exit\(1\)/, 'an unverifiable release invariant must fail, not pass');
});
