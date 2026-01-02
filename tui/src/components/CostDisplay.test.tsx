import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { CostDisplay } from './CostDisplay.js';
import type { CostEstimate } from '../lib/types.js';

function createCost(overrides: Partial<CostEstimate> = {}): CostEstimate {
  return {
    inputTokens: 1000,
    outputTokens: 500,
    inputCost: 0.003,
    outputCost: 0.0075,
    totalCost: 0.0105,
    ...overrides,
  };
}

describe('CostDisplay', () => {
  it('renders nothing when cost is zero', () => {
    const cost = createCost({
      inputTokens: 0,
      outputTokens: 0,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
    });

    const { lastFrame } = render(<CostDisplay cost={cost} model={null} />);
    expect(lastFrame()).toBe('');
  });

  it('renders cost information when present', () => {
    const cost = createCost();
    const { lastFrame } = render(<CostDisplay cost={cost} model="claude-sonnet-4" />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Cost');
    expect(frame).toContain('sonnet');
    expect(frame).toContain('1.0k');
  });

  it('formats large token counts correctly', () => {
    const cost = createCost({
      inputTokens: 1500000,
      outputTokens: 500000,
    });

    const { lastFrame } = render(<CostDisplay cost={cost} model={null} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('1.50M');
    expect(frame).toContain('500.0k');
  });

  it('shows model short name for opus', () => {
    const { lastFrame } = render(<CostDisplay cost={createCost()} model="claude-opus-4-5" />);
    expect(lastFrame()).toContain('opus');
  });

  it('shows model short name for haiku', () => {
    const { lastFrame } = render(<CostDisplay cost={createCost()} model="claude-haiku-3-5" />);
    expect(lastFrame()).toContain('haiku');
  });

  it('shows unknown for null model', () => {
    const { lastFrame } = render(<CostDisplay cost={createCost()} model={null} />);
    expect(lastFrame()).toContain('unknown');
  });
});
