import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, resolveRequestId } from './logger.js';

function memoryLogger() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return {
    logger: createLogger({ app: 'test', level: 'info', destination }),
    lines,
  };
}

describe('createLogger', () => {
  it('writes JSON lines with app, level label and ISO time', () => {
    const { logger, lines } = memoryLogger();
    logger.info({ requestId: 'r-1' }, 'hello');
    expect(lines[0]).toMatchObject({
      app: 'test',
      level: 'info',
      msg: 'hello',
      requestId: 'r-1',
    });
    expect(String(lines[0]?.['time'])).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('censors secret fields', () => {
    const { logger, lines } = memoryLogger();
    logger.info(
      {
        password: 'pw-1',
        provider: { apiKey: 'key-1', token: 'tok-1' },
        req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1' } },
      },
      'secrets',
    );
    const line = JSON.stringify(lines[0]);
    for (const secret of ['pw-1', 'key-1', 'tok-1', 'Bearer abc', 'sid=1']) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[REDACTED]');
  });

  it('masks URL credentials in messages and serialized errors', () => {
    const { logger, lines } = memoryLogger();
    logger.warn('connecting to postgresql://u:pw-2@h/db');
    logger.error(
      { err: new Error('failed redis://:pw-3@h:6379') },
      'probe failed',
    );
    logger.error(
      { err: 'rejected with rediss://:pw-4@h:6380' },
      'non-error rejection',
    );
    const output = JSON.stringify(lines);
    expect(output).not.toMatch(/pw-2|pw-3|pw-4/);
    expect(output).toContain('postgresql://u:***@h/db');
    expect(output).toContain('redis://:***@h:6379');
    expect(output).toContain('rediss://:***@h:6380');
  });

  it('masks URL credentials added by child loggers with their own serializers', () => {
    const { logger, lines } = memoryLogger();
    const child = logger.child(
      { scope: 'request' },
      {
        serializers: {
          err: (e: Error) => ({ raw: e.message, stack: e.stack }),
        },
      },
    );
    child.warn(
      { err: new Error('connect postgresql://u:pw-5@h/db') },
      'child failure',
    );
    expect(JSON.stringify(lines)).not.toContain('pw-5');
  });

  it('keeps every line valid JSON when a URL without credentials precedes a colon and @', () => {
    const { logger, lines } = memoryLogger();
    logger.info(
      { link: 'http://example.test', note: 'user:name@host' },
      'mixed',
    );
    expect(lines[0]).toMatchObject({
      link: 'http://example.test',
      note: 'user:name@host',
    });
  });
});

describe('resolveRequestId', () => {
  it('keeps a well-formed incoming ID', () => {
    expect(resolveRequestId('abc-123_DEF.4:5')).toBe('abc-123_DEF.4:5');
    expect(resolveRequestId(['first-id', 'second'])).toBe('first-id');
  });

  it.each([undefined, '', 'has space', 'x'.repeat(129), 'line\nbreak'])(
    'replaces an unusable ID (%j) with a UUID',
    (header) => {
      expect(resolveRequestId(header)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    },
  );
});
