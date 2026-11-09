import { describe, expect, it } from 'vitest';
import { formatCount, formatRelativeTime } from './format';

const NOW = '2026-11-02T09:00:00.000Z';
const before = (seconds: number) =>
  new Date(Date.parse(NOW) - seconds * 1000).toISOString();

describe('dashboard formatting (task 05C)', () => {
  it('groups digits', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(12_345)).toBe('12,345');
  });

  it('says how long ago, relative to the server time', () => {
    expect(formatRelativeTime(before(10), NOW)).toBe('just now');
    expect(formatRelativeTime(before(50), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(before(5 * 60), NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(before(3 * 3600 + 59), NOW)).toBe('3 hours ago');
    expect(formatRelativeTime(before(86_400), NOW)).toBe('yesterday');
    expect(formatRelativeTime(before(40 * 86_400), NOW)).toBe('40 days ago');
    // A time slightly after the server's (clock skew) is still "just now".
    expect(formatRelativeTime(before(-5), NOW)).toBe('just now');
  });
});
