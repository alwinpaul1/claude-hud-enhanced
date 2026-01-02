import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Bump = 'major' | 'minor' | 'patch';

function parseArgs(argv: string[]) {
  const args: { bump?: Bump; version?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bump') {
      args.bump = argv[i + 1] as Bump;
      i += 1;
    } else if (arg === '--version') {
      args.version = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function bumpVersion(current: string, bump: Bump): string {
  const [major, minor, patch] = current.split('.').map(Number);
  if ([major, minor, patch].some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid version: ${current}`);
  }
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function updateJsonVersion(filePath: string, nextVersion: string): void {
  const raw = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw) as Record<string, unknown>;
  data.version = nextVersion;
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

const args = parseArgs(process.argv.slice(2));
if (!args.bump && !args.version) {
  console.log('Usage: node scripts/release.ts --bump patch|minor|major');
  console.log('   or: node scripts/release.ts --version x.y.z');
  process.exit(1);
}

const tuiPkgPath = resolve('tui/package.json');
const pluginPath = resolve('.claude-plugin/plugin.json');

const tuiPkg = JSON.parse(readFileSync(tuiPkgPath, 'utf-8')) as { version: string };
const nextVersion = args.version || bumpVersion(tuiPkg.version, args.bump as Bump);

updateJsonVersion(tuiPkgPath, nextVersion);
updateJsonVersion(pluginPath, nextVersion);

console.log(`Version bumped to ${nextVersion}. Next: run scripts/changelog.ts.`);
