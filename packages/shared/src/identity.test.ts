import { describe, expect, it } from 'vitest';
import {
  IdentityNormalizationError,
  normalizeDomain,
  normalizeEmail,
} from './identity.js';

describe('normalizeDomain', () => {
  it.each([
    ['example.test', 'example.test'],
    ['  Example.TEST  ', 'example.test'],
    ['https://www.Example.co.uk/about?x=1#top', 'example.co.uk'],
    ['http://user:pass@shop.example.test:8443/path', 'shop.example.test'],
    ['//www.example.test', 'example.test'],
    ['example.test.', 'example.test'],
    ['WWW.www.example.test', 'www.example.test'],
    ['bücher.example', 'xn--bcher-kva.example'],
    ['sub.xn--bcher-kva.example', 'sub.xn--bcher-kva.example'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'localhost',
    'example',
    '192.168.1.10',
    'http://[::1]/',
    '-bad.example.test',
    'bad-.example.test',
    'exa mple.test',
    'example.123',
    'a'.repeat(64) + '.test',
  ])('rejects %j', (input) => {
    expect(() => normalizeDomain(input)).toThrow(IdentityNormalizationError);
  });

  it('is idempotent', () => {
    const once = normalizeDomain('https://WWW.Bücher.Example/');
    expect(normalizeDomain(once)).toBe(once);
  });
});

describe('normalizeEmail', () => {
  it.each([
    ['alex@example.test', 'alex@example.test', 'example.test'],
    ['  Alex.Smith@Example.TEST ', 'alex.smith@example.test', 'example.test'],
    ['alex+leads@example.test', 'alex+leads@example.test', 'example.test'],
    ['alex@www.example.test', 'alex@www.example.test', 'www.example.test'],
    [
      'alex@bücher.example',
      'alex@xn--bcher-kva.example',
      'xn--bcher-kva.example',
    ],
    ['alex@example.test.', 'alex@example.test', 'example.test'],
  ])('%j → %j', (input, email, domain) => {
    expect(normalizeEmail(input)).toEqual({ email, domain });
  });

  it.each([
    '',
    'alex',
    '@example.test',
    'alex@',
    'a@b@example.test',
    '.alex@example.test',
    'alex.@example.test',
    'al..ex@example.test',
    'al ex@example.test',
    '"alex"@example.test',
    'alex@localhost',
    'alex@[127.0.0.1]',
    'alex@example.test/path',
    'x'.repeat(65) + '@example.test',
  ])('rejects %j', (input) => {
    expect(() => normalizeEmail(input)).toThrow(IdentityNormalizationError);
  });

  it('is idempotent', () => {
    const once = normalizeEmail(' Alex@Bücher.Example ').email;
    expect(normalizeEmail(once).email).toBe(once);
  });
});
