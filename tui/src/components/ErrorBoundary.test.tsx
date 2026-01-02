import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import { ErrorBoundary } from './ErrorBoundary.js';

function ThrowingComponent(): React.ReactElement {
  throw new Error('Test error');
}

describe('ErrorBoundary', () => {
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('renders children when no error', () => {
    const { lastFrame } = render(
      <ErrorBoundary>
        <Text>Safe content</Text>
      </ErrorBoundary>,
    );

    expect(lastFrame()).toContain('Safe content');
  });

  it('renders default error UI when child throws', () => {
    const { lastFrame } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(lastFrame()).toContain('⚠ Component error');
  });

  it('renders custom fallback when provided', () => {
    const { lastFrame } = render(
      <ErrorBoundary
        fallback={
          <Box>
            <Text>Custom fallback</Text>
          </Box>
        }
      >
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    expect(lastFrame()).toContain('Custom fallback');
    expect(lastFrame()).not.toContain('⚠ Component error');
  });
});
