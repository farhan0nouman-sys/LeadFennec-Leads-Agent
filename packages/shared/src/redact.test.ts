import { describe, expect, it } from 'vitest';
import { describeError, redactSecrets } from './redact.js';

describe('redactSecrets', () => {
  it.each([
    [
      'postgresql://leadfennec:pw-123@db.internal:5432/app',
      'postgresql://leadfennec:***@db.internal:5432/app',
    ],
    ['redis://:pw-123@127.0.0.1:6379/0', 'redis://:***@127.0.0.1:6379/0'],
    [
      'a postgres://a:x@h/x and rediss://b:y@h2:6380',
      'a postgres://a:***@h/x and rediss://b:***@h2:6380',
    ],
  ])('masks URL credentials in %s', (input, expected) => {
    expect(redactSecrets(input)).toBe(expected);
  });

  it('leaves text without credentials unchanged', () => {
    const text = 'see http://example.com/path or mail user@example.com';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe('describeError', () => {
  it('includes name and code and masks credentials', () => {
    const error = Object.assign(
      new Error('cannot reach postgresql://u:pw-123@h/db'),
      {
        code: 'ECONNREFUSED',
      },
    );
    expect(describeError(error)).toBe(
      'Error (ECONNREFUSED): cannot reach postgresql://u:***@h/db',
    );
  });

  it('handles non-Error values', () => {
    expect(describeError('redis://:pw@h')).toBe('redis://:***@h');
  });
});
