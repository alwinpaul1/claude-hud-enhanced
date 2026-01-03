import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectContextFiles, ContextDetector } from './context-detector.js';

describe('detectContextFiles', () => {
  let tmpDir: string;
  let homeDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-home-'));
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('prefers .claude/CLAUDE.md over project root', () => {
    const projectClaude = path.join(tmpDir, 'CLAUDE.md');
    const hiddenClaude = path.join(tmpDir, '.claude', 'CLAUDE.md');
    fs.mkdirSync(path.dirname(hiddenClaude), { recursive: true });
    fs.writeFileSync(projectClaude, '# Root', 'utf-8');
    fs.writeFileSync(hiddenClaude, '# Hidden', 'utf-8');

    const result = detectContextFiles(tmpDir);

    expect(result.projectClaudeMd).toBe(true);
    expect(result.projectClaudeMdPath).toBe(hiddenClaude);
  });

  it('detects rules in global and project directories', () => {
    const globalRulesPath = path.join(homeDir, '.claude', 'rules');
    const projectRulesPath = path.join(tmpDir, '.claude', 'rules');
    fs.mkdirSync(globalRulesPath, { recursive: true });
    fs.mkdirSync(projectRulesPath, { recursive: true });
    fs.writeFileSync(path.join(globalRulesPath, 'global-1.md'), 'rule', 'utf-8');
    fs.writeFileSync(path.join(globalRulesPath, 'global-2.md'), 'rule', 'utf-8');
    fs.writeFileSync(path.join(projectRulesPath, 'project-1.md'), 'rule', 'utf-8');

    const result = detectContextFiles(tmpDir);

    expect(result.rulesCount).toBe(3);
  });

  it('returns default values when cwd is undefined', () => {
    const result = detectContextFiles(undefined);

    expect(result.projectClaudeMd).toBe(false);
    expect(result.projectClaudeMdPath).toBeNull();
    expect(result.rulesCount).toBe(0);
  });

  it('returns default values when cwd has no context files', () => {
    const result = detectContextFiles(tmpDir);

    expect(result.projectClaudeMd).toBe(false);
    expect(result.projectClaudeMdPath).toBeNull();
    expect(result.rulesCount).toBe(0);
  });
});

describe('ContextDetector', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('caches results until forceRefresh is called', () => {
    const projectClaude = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(projectClaude, '# Root', 'utf-8');

    const detector = new ContextDetector();
    const first = detector.detect(tmpDir);
    expect(first.projectClaudeMd).toBe(true);

    fs.rmSync(projectClaude);

    const cached = detector.detect(tmpDir);
    expect(cached.projectClaudeMd).toBe(true);

    const refreshed = detector.forceRefresh(tmpDir);
    expect(refreshed.projectClaudeMd).toBe(false);
  });
});
