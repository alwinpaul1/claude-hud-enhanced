import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectContextFiles, ContextDetector } from './context-detector.js';

describe('detectContextFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hud-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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

  it('detects project settings permissions count', () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ permissions: { allow: ['a', 'b', 'c'] } }),
      'utf-8',
    );

    const result = detectContextFiles(tmpDir);

    expect(result.projectSettings).toBe(true);
    expect(result.projectSettingsRules).toBe(3);
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
