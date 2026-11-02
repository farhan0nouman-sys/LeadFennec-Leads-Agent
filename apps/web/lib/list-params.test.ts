import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { demosAllowed } from './demos';
import { listParamsQuery, parseListParams } from './list-params';

const schema = z.object({
  q: z.string().trim().max(100).catch(''),
  status: z.enum(['new', 'qualified']).or(z.literal('')).catch(''),
  limit: z.coerce
    .number()
    .pipe(z.union([z.literal(10), z.literal(25)]))
    .catch(10),
});

describe('list parameters from the address (task 05B)', () => {
  it('reads valid values and falls back to defaults for anything else', () => {
    expect(
      parseListParams(
        schema,
        new URLSearchParams('q=acme&status=qualified&limit=25'),
      ),
    ).toEqual({ q: 'acme', status: 'qualified', limit: 25 });
    expect(
      parseListParams(
        schema,
        new URLSearchParams(
          `q=${'x'.repeat(101)}&status=<script>&limit=1000000`,
        ),
      ),
    ).toEqual({ q: '', status: '', limit: 10 });
    expect(parseListParams(schema, new URLSearchParams())).toEqual({
      q: '',
      status: '',
      limit: 10,
    });
  });

  it('writes only what differs from the defaults, in a stable order', () => {
    const defaults = parseListParams(schema, new URLSearchParams());
    expect(
      listParamsQuery({ status: 'new', q: 'a b', limit: 10 }, defaults),
    ).toBe('q=a+b&status=new');
    expect(listParamsQuery(defaults, defaults)).toBe('');
  });
});

describe('fixture demonstrations (task 05B)', () => {
  it('exist in development and test only', () => {
    expect(demosAllowed('development')).toBe(true);
    expect(demosAllowed('test')).toBe(true);
    expect(demosAllowed('staging')).toBe(false);
    expect(demosAllowed('production')).toBe(false);
  });
});
