import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function getLastTag(): string | null {
  try {
    return execSync('git describe --tags --abbrev=0', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function getCommits(fromTag: string | null): string[] {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
  const output = execSync(`git log ${range} --pretty=%s`, { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
  if (!output) return [];
  return output.split('\n');
}

function groupCommits(messages: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {
    Added: [],
    Fixed: [],
    Changed: [],
  };

  for (const message of messages) {
    const match = message.match(/^(\w+):\s*(.+)$/);
    if (!match) {
      groups.Changed.push(message);
      continue;
    }
    const [, type, rest] = match;
    if (type === 'feat') groups.Added.push(rest);
    else if (type === 'fix') groups.Fixed.push(rest);
    else groups.Changed.push(rest);
  }

  return groups;
}

function formatSection(title: string, items: string[]): string {
  if (items.length === 0) return '';
  return `### ${title}\n${items.map((item) => `- ${item}`).join('\n')}\n\n`;
}

function buildEntry(version: string, date: string, messages: string[]): string {
  const groups = groupCommits(messages);
  return (
    `## [${version}] - ${date}\n\n` +
    formatSection('Added', groups.Added) +
    formatSection('Fixed', groups.Fixed) +
    formatSection('Changed', groups.Changed)
  );
}

function insertEntry(changelogPath: string, entry: string): void {
  const content = readFileSync(changelogPath, 'utf-8');
  const lines = content.split('\n');
  const headerIndex = lines.findIndex((line) => line.startsWith('# '));
  const insertAt = headerIndex === -1 ? 0 : headerIndex + 2;
  const updated = [...lines.slice(0, insertAt), entry.trimEnd(), '', ...lines.slice(insertAt)].join(
    '\n',
  );
  writeFileSync(changelogPath, updated, 'utf-8');
}

const version = process.argv[2];
if (!version) {
  console.log('Usage: node scripts/changelog.ts x.y.z');
  process.exit(1);
}

const lastTag = getLastTag();
const commits = getCommits(lastTag);
const date = new Date().toISOString().slice(0, 10);
const entry = buildEntry(version, date, commits);

const changelogPath = resolve('docs/CHANGELOG.md');
insertEntry(changelogPath, entry);

console.log(`Changelog updated for ${version}.`);
