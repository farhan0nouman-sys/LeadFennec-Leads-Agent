// CSV reading and writing (task 07C, docs/decisions.md D-07C-03 and D-07C-05). Pure and
// bounded: the same parser runs in the browser (to show columns for mapping) and on the server
// (the authority). Cells are text only; nothing in a file is evaluated. Written cells are
// protected against spreadsheet formula injection.

export interface CsvLimits {
  /** Characters in the whole text. */
  readonly maxChars: number;
  /** Data rows, the header not included. */
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCellChars: number;
}

export interface CsvTable {
  readonly headers: readonly string[];
  /** Each row has exactly headers.length cells (missing ones are ""). */
  readonly rows: readonly (readonly string[])[];
  /** The line each row starts on (1-based; the header is line 1, blank lines count). */
  readonly lines: readonly number[];
}

export type CsvProblem =
  | 'empty'
  | 'too_large'
  | 'too_many_rows'
  | 'too_many_columns'
  | 'cell_too_long'
  | 'unclosed_quote'
  | 'stray_quote'
  | 'too_many_cells'
  | 'duplicate_header'
  | 'blank_header';

const PROBLEM_TEXT: Readonly<Record<CsvProblem, string>> = {
  empty: 'The file has no header row.',
  too_large: 'The file is too large.',
  too_many_rows: 'The file has too many rows.',
  too_many_columns: 'The file has too many columns.',
  cell_too_long: 'A cell is too long.',
  unclosed_quote: 'A quoted cell is not closed.',
  stray_quote: 'A quote appears inside a cell that is not quoted.',
  too_many_cells: 'A row has more cells than the header.',
  duplicate_header: 'Two columns have the same name.',
  blank_header: 'A column has no name.',
};

/** The file can't be read as a table; `line` is 1-based (the header is line 1). */
export class CsvError extends Error {
  override readonly name = 'CsvError';

  constructor(
    readonly problem: CsvProblem,
    readonly line: number | null,
  ) {
    super(
      line === null
        ? PROBLEM_TEXT[problem]
        : `${PROBLEM_TEXT[problem]} (line ${String(line)})`,
    );
  }
}

/**
 * RFC 4180 with the usual leniencies: LF or CRLF line ends, a UTF-8 byte-order mark, a
 * trailing line end, and blank lines (skipped). Fields may be quoted, with "" for a quote.
 * Header names are trimmed. Throws CsvError at the first problem.
 */
export function parseCsv(text: string, limits: CsvLimits): CsvTable {
  if (text.length > limits.maxChars) {
    throw new CsvError('too_large', null);
  }
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const records: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let recordLine = 1;

  const pushCell = () => {
    if (cell.length > limits.maxCellChars) {
      throw new CsvError('cell_too_long', recordLine);
    }
    cells.push(cell);
    if (cells.length > limits.maxColumns) {
      throw new CsvError('too_many_columns', recordLine);
    }
    cell = '';
    wasQuoted = false;
  };
  const pushRecord = () => {
    pushCell();
    // A blank line is one empty, unquoted cell: skipped.
    if (!(cells.length === 1 && cells[0] === '')) {
      records.push({ cells, line: recordLine });
      if (records.length > limits.maxRows + 1) {
        throw new CsvError('too_many_rows', recordLine);
      }
    }
    cells = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (char === '\n') {
          line += 1;
        }
        cell += char;
        if (cell.length > limits.maxCellChars) {
          throw new CsvError('cell_too_long', recordLine);
        }
      }
      continue;
    }
    if (char === '"') {
      if (cell !== '' || wasQuoted) {
        throw new CsvError('stray_quote', line);
      }
      quoted = true;
      wasQuoted = true;
    } else if (char === ',') {
      pushCell();
    } else if (char === '\r' && source[i + 1] === '\n') {
      // The \n ends the record.
    } else if (char === '\n' || char === '\r') {
      pushRecord();
      line += 1;
      recordLine = line;
    } else if (wasQuoted) {
      // Text after a closing quote: `"a"b`.
      throw new CsvError('stray_quote', line);
    } else {
      cell += char;
    }
  }
  if (quoted) {
    throw new CsvError('unclosed_quote', recordLine);
  }
  if (cell !== '' || wasQuoted || cells.length > 0) {
    pushRecord();
  }

  const [header, ...body] = records;
  if (header === undefined) {
    throw new CsvError('empty', null);
  }
  const headers = header.cells.map((name) => name.trim());
  const seen = new Set<string>();
  for (const name of headers) {
    if (name === '') {
      throw new CsvError('blank_header', 1);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new CsvError('duplicate_header', 1);
    }
    seen.add(key);
  }
  if (body.length > limits.maxRows) {
    throw new CsvError('too_many_rows', body[limits.maxRows]?.line ?? null);
  }
  const rows = body.map(({ cells: row, line: at }) => {
    if (row.length > headers.length) {
      throw new CsvError('too_many_cells', at);
    }
    return [...row, ...Array<string>(headers.length - row.length).fill('')];
  });
  return { headers, rows, lines: body.map((record) => record.line) };
}

/**
 * One cell for a CSV a person will open in a spreadsheet. A cell that a spreadsheet would
 * read as a formula (starting with =, +, -, @, a tab or a carriage return, also after
 * leading spaces) gets a leading apostrophe, so it stays text (OWASP CSV injection guidance).
 * Cells with a comma, quote or line end are quoted.
 */
export function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A whole CSV document, CRLF line ends, every cell through csvCell. */
export function toCsv(
  rows: readonly (readonly (string | number | null)[])[],
): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
