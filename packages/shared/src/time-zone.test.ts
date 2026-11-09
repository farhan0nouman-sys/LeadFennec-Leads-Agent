import { describe, expect, it } from 'vitest';
import { normalizeTimeZone, TimeZoneError } from './time-zone.js';

describe('normalizeTimeZone', () => {
  it.each([
    ['UTC', 'UTC'],
    [' utc ', 'UTC'],
    ['Etc/UTC', 'UTC'],
    ['America/New_York', 'America/New_York'],
    ['america/new_york', 'America/New_York'],
    ['  Europe/London ', 'Europe/London'],
    ['EUROPE/LONDON', 'Europe/London'],
    ['America/Port-au-Prince', 'America/Port-au-Prince'],
    ['Etc/GMT+5', 'Etc/GMT+5'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeTimeZone(input)).toBe(expected);
  });

  it('resolves an alias to an equivalent IANA name', () => {
    // ICU may prefer its own name for an alias; both spellings are valid IANA names.
    expect(['America/New_York', 'US/Eastern']).toContain(
      normalizeTimeZone('US/Eastern'),
    );
    expect(['Asia/Kolkata', 'Asia/Calcutta']).toContain(
      normalizeTimeZone('asia/kolkata'),
    );
  });

  it.each([
    '',
    '   ',
    'EST',
    'EST5EDT',
    'GMT',
    'Japan',
    '+05:00',
    'UTC+5',
    'America',
    'America/',
    '/New_York',
    'America/New York',
    'Mars/Olympus',
    `${'A'.repeat(30)}/${'B'.repeat(40)}`,
  ])('rejects %j', (input) => {
    expect(() => normalizeTimeZone(input)).toThrow(TimeZoneError);
  });

  it('is idempotent and returns the stored spelling for every runtime zone', () => {
    for (const zone of Intl.supportedValuesOf('timeZone')) {
      const once = normalizeTimeZone(zone);
      expect(normalizeTimeZone(once)).toBe(once);
      expect(once).toMatch(/^(UTC|[A-Z][A-Za-z]*(\/[A-Z][A-Za-z0-9_+-]*)+)$/);
    }
  });
});
