import { describe, expect, it } from 'vitest';
import { CsvError, csvCell, parseCsv, toCsv, type CsvLimits } from './csv.js';
import {
  ORGANIZATION_IMPORT_LIMITS,
  csvImportRequestSchema,
  importMappingSchema,
  normalizeImportRow,
} from './contracts/organization-import.js';

// CSV reading, formula-safe writing and row normalization (task 07C, D-07C-03 and D-07C-05).
const LIMITS: CsvLimits = {
  maxChars: 10_000,
  maxRows: 3,
  maxColumns: 4,
  maxCellChars: 20,
};

const problem = (text: string, limits = LIMITS) => {
  try {
    parseCsv(text, limits);
  } catch (error) {
    expect(error).toBeInstanceOf(CsvError);
    return {
      problem: (error as CsvError).problem,
      line: (error as CsvError).line,
    };
  }
  throw new Error('expected a CsvError');
};

describe('parseCsv (task 07C)', () => {
  it('reads RFC 4180 with quotes, CRLF, a BOM and blank lines', () => {
    const table = parseCsv(
      '﻿ Name ,Domain\r\n"Acme, Inc.","acme.example"\r\n\r\n"Say ""hi""",\n"Two\nlines",x.example\n',
      LIMITS,
    );
    expect(table.headers).toEqual(['Name', 'Domain']);
    expect(table.rows).toEqual([
      ['Acme, Inc.', 'acme.example'],
      ['Say "hi"', ''],
      ['Two\nlines', 'x.example'],
    ]);
    // Rows know their line (the blank line 3 counts).
    expect(table.lines).toEqual([2, 4, 5]);
    // Short rows are padded; nothing is evaluated.
    expect(parseCsv('a,b\n=1+1', LIMITS).rows).toEqual([['=1+1', '']]);
  });

  it('refuses what it cannot read safely, with the line', () => {
    expect(problem('')).toEqual({ problem: 'empty', line: null });
    expect(problem('a,b\n"open')).toEqual({
      problem: 'unclosed_quote',
      line: 2,
    });
    expect(problem('a\nab"c')).toEqual({ problem: 'stray_quote', line: 2 });
    expect(problem('a\n"b"c')).toEqual({ problem: 'stray_quote', line: 2 });
    expect(problem('a\nb,c')).toEqual({ problem: 'too_many_cells', line: 2 });
    expect(problem('a,A')).toEqual({ problem: 'duplicate_header', line: 1 });
    expect(problem('a,,b')).toEqual({ problem: 'blank_header', line: 1 });
    expect(problem('a,b,c,d,e')).toMatchObject({ problem: 'too_many_columns' });
    expect(problem(`a\n${'x'.repeat(21)}`)).toMatchObject({
      problem: 'cell_too_long',
    });
    expect(problem('a\n1\n2\n3\n4')).toMatchObject({
      problem: 'too_many_rows',
    });
    expect(problem('x'.repeat(10_001))).toEqual({
      problem: 'too_large',
      line: null,
    });
    expect(new CsvError('stray_quote', 4).message).toBe(
      'A quote appears inside a cell that is not quoted. (line 4)',
    );
  });
});

describe('csvCell and toCsv: formula injection (task 07C)', () => {
  it('keeps cells a spreadsheet would run as formulas as text', () => {
    for (const formula of [
      '=HYPERLINK("http://evil.example","x")',
      '+1+1',
      '-2+3',
      '@SUM(A1)',
      '\t=1',
      '\r=1',
      '  =1',
    ]) {
      const cell = csvCell(formula);
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    }
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('Acme, Inc.')).toBe('"Acme, Inc."');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
    expect(
      toCsv([
        ['Row', 'Message'],
        [2, '=cmd'],
      ]),
    ).toBe("Row,Message\r\n2,'=cmd\r\n");
    // What toCsv writes, parseCsv reads back (with the protecting apostrophe).
    expect(
      parseCsv(toCsv([['a'], ['=x,"y"']]), ORGANIZATION_IMPORT_LIMITS).rows,
    ).toEqual([['\'=x,"y"']]);
  });
});

describe('CSV import rows (task 07C)', () => {
  it('normalizes a row safely', () => {
    const result = normalizeImportRow({
      name: '  Acme\u0000  Analytics‮ GmbH ',
      domain: 'WWW.Acme-Analytics.example',
      website: 'acme-analytics.example/about',
      industry: ' Software ',
      employees: '1,200',
      country: 'de',
    });
    expect(result).toEqual({
      ok: true,
      organization: {
        identity: {
          name: 'Acme Analytics GmbH',
          nameKey: 'acme analytics',
          domain: 'acme-analytics.example',
          key: 'domain:acme-analytics.example',
        },
        websiteUrl: 'https://acme-analytics.example/about',
        industry: 'Software',
        employeeCount: 1200,
        countryCode: 'DE',
      },
    });
    // Without a domain the website gives one; without either, the name is the identity.
    expect(
      normalizeImportRow({ name: 'Beta', website: 'http://beta.example' }),
    ).toMatchObject({
      ok: true,
      organization: { identity: { key: 'domain:beta.example' } },
    });
    expect(normalizeImportRow({ name: 'Gamma Ltd' })).toMatchObject({
      ok: true,
      organization: { identity: { key: 'name:gamma' } },
    });
  });

  it('reports every problem of a row, by field', () => {
    expect(
      normalizeImportRow({
        name: ' ',
        domain: 'not a domain',
        website: 'javascript:alert(1)',
        employees: 'about 50',
        country: 'Germany',
      }),
    ).toEqual({
      ok: false,
      issues: [
        { field: 'domain', message: 'This is not a domain.' },
        {
          field: 'website',
          message: 'Use a web address, such as https://example.com.',
        },
        {
          field: 'employees',
          message: 'Use a whole number of employees, such as 120.',
        },
        {
          field: 'country',
          message: 'Use a two-letter country code, such as US.',
        },
        { field: 'name', message: 'Enter a company name.' },
      ],
    });
    expect(normalizeImportRow({ name: '!!!' })).toEqual({
      ok: false,
      issues: [
        { field: 'name', message: 'Use a name with letters or digits.' },
      ],
    });
  });

  it('checks the mapping and the request', () => {
    expect(importMappingSchema.safeParse({ domain: 'Domain' }).success).toBe(
      false,
    );
    const twice = importMappingSchema.safeParse({
      name: 'Company',
      domain: 'company',
    });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]).toMatchObject({
      path: ['domain'],
      message: 'This column is already used for another field.',
    });
    expect(
      csvImportRequestSchema.safeParse({
        fileName: 'a.csv',
        content: 'x'.repeat(ORGANIZATION_IMPORT_LIMITS.maxChars + 1),
        mapping: { name: 'Name' },
      }).error?.issues[0]?.message,
    ).toBe('The file is larger than 256 KB. Split it into smaller files.');
    expect(
      csvImportRequestSchema.safeParse({
        fileName: 'a.csv',
        content: 'Name\nAcme',
        mapping: { name: 'Name', notes: 'Notes' },
      }).success,
    ).toBe(false);
  });
});
