import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Sparkline } from './Sparkline.js';

describe('Sparkline', () => {
  it('should render empty state for no data', () => {
    const { lastFrame } = render(<Sparkline data={[]} />);
    expect(lastFrame()).toContain('─');
  });

  it('should render sparkline for data', () => {
    const { lastFrame } = render(<Sparkline data={[1, 2, 3, 4, 5]} />);
    const frame = lastFrame() || '';
    // Should contain sparkline characters
    expect(frame.match(/[▁▂▃▄▅▆▇█]/)).not.toBeNull();
  });

  it('should render with custom width', () => {
    const { lastFrame } = render(<Sparkline data={[1, 2, 3]} width={10} />);
    const frame = lastFrame() || '';
    // Width should be approximately 10 chars
    expect(frame.length).toBeLessThanOrEqual(15); // Allow for ANSI codes
  });

  it('should handle single data point', () => {
    const { lastFrame } = render(<Sparkline data={[5]} />);
    const frame = lastFrame() || '';
    expect(frame.match(/[▁▂▃▄▅▆▇█]/)).not.toBeNull();
  });

  it('should handle constant data', () => {
    const { lastFrame } = render(<Sparkline data={[5, 5, 5, 5, 5]} />);
    const frame = lastFrame() || '';
    // All same value should show lowest block
    expect(frame).toContain('▁');
  });

  it('should handle increasing data', () => {
    const { lastFrame } = render(<Sparkline data={[1, 2, 3, 4, 5, 6, 7, 8]} />);
    const frame = lastFrame() || '';
    // Should contain both low and high blocks
    expect(frame).toContain('▁');
    expect(frame).toContain('█');
  });

  it('should handle decreasing data', () => {
    const { lastFrame } = render(<Sparkline data={[8, 7, 6, 5, 4, 3, 2, 1]} />);
    const frame = lastFrame() || '';
    // Should contain both high and low blocks
    expect(frame).toContain('█');
    expect(frame).toContain('▁');
  });

  it('should truncate data to width', () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const { lastFrame } = render(<Sparkline data={data} width={10} />);
    const frame = lastFrame() || '';
    // Should only show last 10 data points worth
    const sparkChars = (frame.match(/[▁▂▃▄▅▆▇█]/g) || []).length;
    expect(sparkChars).toBeLessThanOrEqual(10);
  });

  it('should handle zero values', () => {
    const { lastFrame } = render(<Sparkline data={[0, 0, 0, 1]} />);
    const frame = lastFrame() || '';
    expect(frame.match(/[▁▂▃▄▅▆▇█]/)).not.toBeNull();
  });

  it('should handle negative values', () => {
    const { lastFrame } = render(<Sparkline data={[-5, -3, 0, 3, 5]} />);
    const frame = lastFrame() || '';
    expect(frame.match(/[▁▂▃▄▅▆▇█]/)).not.toBeNull();
  });

  it('should handle very large values', () => {
    const { lastFrame } = render(<Sparkline data={[1000000, 2000000, 3000000]} />);
    const frame = lastFrame() || '';
    expect(frame.match(/[▁▂▃▄▅▆▇█]/)).not.toBeNull();
  });
});
