import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ContextInfo } from './ContextInfo.js';
import type { ContextFiles } from '../lib/context-detector.js';

describe('ContextInfo', () => {
  it('should render nothing when contextFiles is null', () => {
    const { lastFrame } = render(<ContextInfo contextFiles={null} />);
    expect(lastFrame()).toBe('');
  });

  it('should render nothing when no context files exist', () => {
    const contextFiles: ContextFiles = {
      globalClaudeMd: false,
      projectClaudeMd: false,
      projectClaudeMdPath: null,
      rulesCount: 0,
    };
    const { lastFrame } = render(<ContextInfo contextFiles={contextFiles} />);
    expect(lastFrame()).toBe('');
  });

  it('should show 1 CLAUDE.md when only global exists', () => {
    const contextFiles: ContextFiles = {
      globalClaudeMd: true,
      projectClaudeMd: false,
      projectClaudeMdPath: null,
      rulesCount: 0,
    };
    const { lastFrame } = render(<ContextInfo contextFiles={contextFiles} />);
    expect(lastFrame()).toContain('1 CLAUDE.md');
  });

  it('should show 1 CLAUDE.md when only project exists', () => {
    const contextFiles: ContextFiles = {
      globalClaudeMd: false,
      projectClaudeMd: true,
      projectClaudeMdPath: '/path/to/CLAUDE.md',
      rulesCount: 0,
    };
    const { lastFrame } = render(<ContextInfo contextFiles={contextFiles} />);
    expect(lastFrame()).toContain('1 CLAUDE.md');
  });

  it('should show 2 CLAUDE.md when both exist', () => {
    const contextFiles: ContextFiles = {
      globalClaudeMd: true,
      projectClaudeMd: true,
      projectClaudeMdPath: '/path/to/CLAUDE.md',
      rulesCount: 0,
    };
    const { lastFrame } = render(<ContextInfo contextFiles={contextFiles} />);
    expect(lastFrame()).toContain('2 CLAUDE.md');
  });

  it('should show rules count when rules exist', () => {
    const contextFiles: ContextFiles = {
      globalClaudeMd: false,
      projectClaudeMd: false,
      projectClaudeMdPath: null,
      rulesCount: 5,
    };
    const { lastFrame } = render(<ContextInfo contextFiles={contextFiles} />);
    expect(lastFrame()).toContain('5 rules');
  });

  it('should not show rules when count is 0', () => {
    const contextFiles: ContextFiles = {
      globalClaudeMd: true,
      projectClaudeMd: false,
      projectClaudeMdPath: null,
      rulesCount: 0,
    };
    const { lastFrame } = render(<ContextInfo contextFiles={contextFiles} />);
    expect(lastFrame()).toContain('1 CLAUDE.md');
    expect(lastFrame()).not.toContain('rules');
  });

  it('should show both CLAUDE.md and rules', () => {
    const contextFiles: ContextFiles = {
      globalClaudeMd: true,
      projectClaudeMd: true,
      projectClaudeMdPath: '/path/to/CLAUDE.md',
      rulesCount: 10,
    };
    const { lastFrame } = render(<ContextInfo contextFiles={contextFiles} />);
    expect(lastFrame()).toContain('2 CLAUDE.md');
    expect(lastFrame()).toContain('10 rules');
  });
});
