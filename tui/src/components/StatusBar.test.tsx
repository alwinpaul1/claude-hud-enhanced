import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { StatusBar } from './StatusBar.js';
import type { SettingsData } from '../lib/settings-reader.js';

describe('StatusBar', () => {
  const mockSettings: SettingsData = {
    model: 'claude-sonnet-4',
    pluginCount: 3,
    mcpCount: 2,
  };

  it('should render model name from settings', () => {
    const { lastFrame } = render(<StatusBar settings={mockSettings} isIdle={true} />);
    expect(lastFrame()).toContain('claude-sonnet-4');
  });

  it('should show ? when settings is null', () => {
    const { lastFrame } = render(<StatusBar settings={null} isIdle={true} />);
    expect(lastFrame()).toContain('?');
  });

  it('should show idle indicator when idle', () => {
    const { lastFrame } = render(<StatusBar settings={mockSettings} isIdle={true} />);
    expect(lastFrame()).toContain('💤');
  });

  it('should show working indicator when not idle', () => {
    const { lastFrame } = render(<StatusBar settings={mockSettings} isIdle={false} />);
    expect(lastFrame()).toContain('⚡');
  });

  it('should show plugin and MCP counts', () => {
    const { lastFrame } = render(<StatusBar settings={mockSettings} isIdle={true} />);
    expect(lastFrame()).toContain('plugins:');
    expect(lastFrame()).toContain('3');
    expect(lastFrame()).toContain('MCP:');
    expect(lastFrame()).toContain('2');
  });

  it('should not show plugin info when settings is null', () => {
    const { lastFrame } = render(<StatusBar settings={null} isIdle={true} />);
    expect(lastFrame()).not.toContain('plugins:');
  });

  it('should render cwd when provided', () => {
    const { lastFrame } = render(
      <StatusBar settings={mockSettings} isIdle={true} cwd="/home/user/project" />,
    );
    expect(lastFrame()).toContain('📁');
    expect(lastFrame()).toContain('/home/user/project');
  });

  it('should not render cwd row when cwd is undefined', () => {
    const { lastFrame } = render(<StatusBar settings={mockSettings} isIdle={true} />);
    expect(lastFrame()).not.toContain('📁');
  });

  it('should truncate long paths', () => {
    const longPath = '/Users/username/Documents/projects/my-very-long-project-name';
    const { lastFrame } = render(
      <StatusBar settings={mockSettings} isIdle={true} cwd={longPath} />,
    );
    const frame = lastFrame() || '';
    expect(frame).toContain('📁');
    expect(frame).toContain('...');
  });

  it('should show short paths without truncation', () => {
    const shortPath = '/home/user';
    const { lastFrame } = render(
      <StatusBar settings={mockSettings} isIdle={true} cwd={shortPath} />,
    );
    expect(lastFrame()).toContain(shortPath);
  });

  it('should handle path with few segments', () => {
    const path = '/a/' + 'x'.repeat(40);
    const { lastFrame } = render(<StatusBar settings={mockSettings} isIdle={true} cwd={path} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('📁');
    expect(frame).toContain('...');
  });
});
