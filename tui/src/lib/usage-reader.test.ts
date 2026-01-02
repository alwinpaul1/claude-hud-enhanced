import { describe, it, expect, beforeEach } from 'vitest';
import { UsageReader, UsageData } from './usage-reader.js';

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

    const data = (
      reader as unknown as { parseOutput: (o: string) => UsageData | null }
    ).parseOutput(output);

    expect(data).not.toBeNull();
    expect(data?.sessionPercent).toBe(12);
    expect(data?.sessionResetTime).toBe('in 3 hours');
    expect(data?.weekPercent).toBe(45);
    expect(data?.weekResetTime).toBe('in 2 days');
  });

  it('returns null for unrecognized output', () => {
    const output = ['No usage data', 'Nothing to see here'].join('\n');

    const data = (reader as unknown as { parseOutput: (o: string) => unknown }).parseOutput(output);

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
    const resolver: {
      resolve: ((value: { sessionPercent: number; sessionResetTime: string }) => void) | null;
    } = { resolve: null };
    const pending = new Promise<{ sessionPercent: number; sessionResetTime: string }>((resolve) => {
      resolver.resolve = resolve;
    });

    (reader as unknown as { fetchUsage: () => Promise<unknown> }).fetchUsage = async () => {
      calls++;
      return pending;
    };

    const firstPromise = reader.read();
    const second = await reader.read();

    expect(calls).toBe(1);
    expect(second).toBeNull();

    resolver.resolve?.({ sessionPercent: 1, sessionResetTime: 'soon' });
    const first = await firstPromise;
    expect(first).not.toBeNull();
  });

  it('invalidate() clears cache and allows refetch', async () => {
    let calls = 0;
    (reader as unknown as { fetchUsage: () => Promise<unknown> }).fetchUsage = async () => {
      calls++;
      return { sessionPercent: calls * 10, sessionResetTime: 'soon' };
    };

    const first = await reader.read();
    expect(first?.sessionPercent).toBe(10);
    expect(calls).toBe(1);

    reader.invalidate();

    const second = await reader.read();
    expect(second?.sessionPercent).toBe(20);
    expect(calls).toBe(2);
  });

  it('handles session-only output without week data', () => {
    const output = ['Current session', 'Resets in 1 hour', '50% used'].join('\n');

    const data = (
      reader as unknown as { parseOutput: (o: string) => UsageData | null }
    ).parseOutput(output);

    expect(data).not.toBeNull();
    expect(data?.sessionPercent).toBe(50);
    expect(data?.sessionResetTime).toBe('in 1 hour');
    expect(data?.weekPercent).toBeUndefined();
    expect(data?.weekResetTime).toBeUndefined();
  });

  it('handles output with 0% session usage', () => {
    const output = ['Current session', 'Resets in 4 hours', '0% used'].join('\n');

    const data = (
      reader as unknown as { parseOutput: (o: string) => UsageData | null }
    ).parseOutput(output);

    expect(data).not.toBeNull();
    expect(data?.sessionPercent).toBe(0);
    expect(data?.sessionResetTime).toBe('in 4 hours');
  });

  it('handles malformed input gracefully', () => {
    const data = (
      reader as unknown as { parseOutput: (o: string) => UsageData | null }
    ).parseOutput('');
    expect(data).toBeNull();
  });
});
