import { describe, it, expect, beforeEach } from 'vitest';
import { UsageReader } from './usage-reader.js';

describe('UsageReader', () => {
  let reader: UsageReader;

  beforeEach(() => {
    reader = new UsageReader();
  });

  it('parses session and week usage output', () => {
    const output = [
      'Current session',
      'Resets in 3 hours (approx)',
      '12% used',
      '',
      'Current week',
      '45% used',
      'Resets in 2 days (approx)',
    ].join('\n');

    const data = (reader as unknown as { parseOutput: (o: string) => unknown }).parseOutput(
      output,
    ) as ReturnType<UsageReader['read']>;

    expect(data).not.toBeNull();
    expect(data?.sessionPercent).toBe(12);
    expect(data?.sessionResetTime).toBe('in 3 hours');
    expect(data?.weekPercent).toBe(45);
    expect(data?.weekResetTime).toBe('in 2 days');
  });

  it('returns null for unrecognized output', () => {
    const output = ['No usage data', 'Nothing to see here'].join('\n');

    const data = (reader as unknown as { parseOutput: (o: string) => unknown }).parseOutput(
      output,
    );

    expect(data).toBeNull();
  });

  it('caches usage results within the minimum interval', async () => {
    let calls = 0;
    (reader as unknown as { fetchUsage: () => Promise<unknown> }).fetchUsage = async () => {
      calls++;
      return { sessionPercent: 5, sessionResetTime: 'soon' };
    };

    const first = await reader.read();
    const second = await reader.read();

    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it('avoids overlapping fetch calls', async () => {
    let calls = 0;
    let resolveFetch: (value: { sessionPercent: number; sessionResetTime: string }) => void;
    const pending = new Promise<{ sessionPercent: number; sessionResetTime: string }>((resolve) => {
      resolveFetch = resolve;
    });

    (reader as unknown as { fetchUsage: () => Promise<unknown> }).fetchUsage = async () => {
      calls++;
      return pending;
    };

    const firstPromise = reader.read();
    const second = await reader.read();

    expect(calls).toBe(1);
    expect(second).toBeNull();

    resolveFetch!({ sessionPercent: 1, sessionResetTime: 'soon' });
    const first = await firstPromise;
    expect(first).not.toBeNull();
  });
});
