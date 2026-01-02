import { describe, it, expect } from 'vitest';
import { formatDuration } from './useElapsedTime.js';

describe('formatDuration', () => {
  describe('seconds', () => {
    it('should format 0ms as 0s', () => {
      expect(formatDuration(0)).toBe('0s');
    });

    it('should format 1000ms as 1s', () => {
      expect(formatDuration(1000)).toBe('1s');
    });

    it('should format 30000ms as 30s', () => {
      expect(formatDuration(30000)).toBe('30s');
    });

    it('should format 59999ms as 60s', () => {
      expect(formatDuration(59999)).toBe('60s');
    });

    it('should round milliseconds to nearest second', () => {
      expect(formatDuration(1499)).toBe('1s');
      expect(formatDuration(1500)).toBe('2s');
    });
  });

  describe('minutes', () => {
    it('should format 60000ms as 1m 0s', () => {
      expect(formatDuration(60000)).toBe('1m 0s');
    });

    it('should format 90000ms as 1m 30s', () => {
      expect(formatDuration(90000)).toBe('1m 30s');
    });

    it('should format 5 minutes as 5m 0s', () => {
      expect(formatDuration(5 * 60000)).toBe('5m 0s');
    });

    it('should format 59 minutes 59 seconds correctly', () => {
      expect(formatDuration(59 * 60000 + 59000)).toBe('59m 59s');
    });
  });

  describe('hours', () => {
    it('should format 60 minutes as 1h 0m', () => {
      expect(formatDuration(60 * 60000)).toBe('1h 0m');
    });

    it('should format 90 minutes as 1h 30m', () => {
      expect(formatDuration(90 * 60000)).toBe('1h 30m');
    });

    it('should format 2 hours as 2h 0m', () => {
      expect(formatDuration(2 * 60 * 60000)).toBe('2h 0m');
    });

    it('should format 10 hours 45 minutes as 10h 45m', () => {
      expect(formatDuration(10 * 60 * 60000 + 45 * 60000)).toBe('10h 45m');
    });
  });

  describe('edge cases', () => {
    it('should handle very large durations', () => {
      const twentyFourHours = 24 * 60 * 60000;
      expect(formatDuration(twentyFourHours)).toBe('24h 0m');
    });

    it('should handle fractional milliseconds by rounding', () => {
      expect(formatDuration(1500)).toBe('2s');
      expect(formatDuration(1400)).toBe('1s');
    });
  });
});
