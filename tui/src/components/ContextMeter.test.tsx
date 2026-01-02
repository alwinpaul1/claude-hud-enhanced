import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ContextMeter } from './ContextMeter.js';
import type { ContextHealth } from '../lib/types.js';

function createContext(overrides: Partial<ContextHealth> = {}): ContextHealth {
  return {
    tokens: 50000,
    percent: 25,
    remaining: 150000,
    maxTokens: 200000,
    burnRate: 100,
    status: 'healthy',
    shouldCompact: false,
    breakdown: {
      toolOutputs: 30000,
      toolInputs: 10000,
      messages: 10000,
      other: 0,
    },
    sessionStart: Date.now(),
    lastUpdate: Date.now(),
    tokenHistory: [10000, 20000, 30000, 40000, 50000],
    ...overrides,
  };
}

describe('ContextMeter', () => {
  it('should render context header', () => {
    const { lastFrame } = render(<ContextMeter context={createContext()} />);
    expect(lastFrame()).toContain('Context');
  });

  it('should show percentage', () => {
    const { lastFrame } = render(<ContextMeter context={createContext({ percent: 45 })} />);
    expect(lastFrame()).toContain('45%');
  });

  it('should show compact warning when shouldCompact is true', () => {
    const { lastFrame } = render(<ContextMeter context={createContext({ shouldCompact: true })} />);
    expect(lastFrame()).toContain('COMPACT');
  });

  it('should not show compact warning when shouldCompact is false', () => {
    const { lastFrame } = render(
      <ContextMeter context={createContext({ shouldCompact: false })} />,
    );
    expect(lastFrame()).not.toContain('COMPACT');
  });

  it('should format large token counts with k suffix', () => {
    const { lastFrame } = render(
      <ContextMeter context={createContext({ tokens: 150000, remaining: 50000 })} />,
    );
    expect(lastFrame()).toContain('150k used');
    expect(lastFrame()).toContain('50k left');
  });

  it('should format very large token counts with M suffix', () => {
    const { lastFrame } = render(
      <ContextMeter context={createContext({ tokens: 1500000, remaining: 500000 })} />,
    );
    expect(lastFrame()).toContain('1.5M used');
  });

  it('should format small token counts without suffix', () => {
    const { lastFrame } = render(
      <ContextMeter context={createContext({ tokens: 500, remaining: 199500 })} />,
    );
    expect(lastFrame()).toContain('500 used');
  });

  it('should show progress bar', () => {
    const { lastFrame } = render(<ContextMeter context={createContext({ percent: 50 })} />);
    const frame = lastFrame() || '';
    expect(frame).toContain('█');
    expect(frame).toContain('░');
  });

  it('should render sparkline with usage label', () => {
    const { lastFrame } = render(<ContextMeter context={createContext()} />);
    expect(lastFrame()).toContain('usage');
  });
});
