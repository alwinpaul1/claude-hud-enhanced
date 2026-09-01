#!/usr/bin/env node
// Release guard. Runs before build and test in the Release workflow.
//
// Two invariants, both learned the hard way on 2026-09-01:
//
// 1. THE TAG MUST NAME THE VERSION IT SHIPS. Nothing compared them, so `v0.9.9`
//    could be pushed at a 0.7.3 tree and the release would publish under a
//    version the plugin does not declare.
//
// 2. A RELEASED VERSION IS IMMUTABLE. v0.7.3 was force-moved across three
//    different trees while every one of them declared "0.7.3". The marketplace
//    resolves from the default branch, not from GitHub Releases, so each of
//    those trees was live under the same version string. Whoever updated during
//    that window holds a "0.7.3" that no longer exists anywhere. Reusing a
//    version that already has a release is the bug; bump instead.

import { readFile } from 'node:fs/promises';

export function parseTagVersion(tagName) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tagName ?? '');
  return match ? match[1] : null;
}

export function checkTagMatchesVersion(tagName, pluginVersion) {
  const tagVersion = parseTagVersion(tagName);
  if (tagVersion === null) {
    return { ok: false, reason: `tag "${tagName}" is not of the form vMAJOR.MINOR.PATCH` };
  }
  if (tagVersion !== pluginVersion) {
    return {
      ok: false,
      reason: `tag ${tagName} ships version ${tagVersion}, but plugin.json declares ${pluginVersion}`,
    };
  }
  return { ok: true, version: tagVersion };
}

export function checkVersionNotAlreadyReleased(version, existingReleaseTags) {
  if (existingReleaseTags.includes(`v${version}`)) {
    return {
      ok: false,
      reason:
        `v${version} already has a published release. A released version is immutable — ` +
        `re-cutting it makes one version name two different trees. Bump the version instead.`,
    };
  }
  return { ok: true };
}

async function main() {
  const tagName = process.env.GITHUB_REF_NAME;
  const pluginUrl = new URL('../.claude-plugin/plugin.json', import.meta.url);
  const { version } = JSON.parse(await readFile(pluginUrl, 'utf8'));

  const matches = checkTagMatchesVersion(tagName, version);
  if (!matches.ok) {
    console.error(`release guard: ${matches.reason}`);
    process.exit(1);
  }

  // Tags with a published release, straight from the API. No token needed for a
  // public repo; on failure we do not silently pass — an unverifiable invariant
  // is reported as a failure, not as a skip.
  const repo = process.env.GITHUB_REPOSITORY;
  let releaseTags;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
      headers: {
        accept: 'application/vnd.github+json',
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
    releaseTags = (await res.json()).map((r) => r.tag_name);
  } catch (err) {
    console.error(`release guard: could not list existing releases (${err.message})`);
    process.exit(1);
  }

  const unreleased = checkVersionNotAlreadyReleased(version, releaseTags);
  if (!unreleased.ok) {
    console.error(`release guard: ${unreleased.reason}`);
    process.exit(1);
  }

  console.log(`release guard: ${tagName} matches plugin.json ${version}, and is not yet released.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
