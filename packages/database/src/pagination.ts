// Keyset (cursor) pagination over UUIDv7 ids (docs/decisions.md D-03C-06).
//
// Every tenant table has the primary key (tenant_id, id), and ids are UUIDv7, which sort by
// creation time. A tenant-scoped page is therefore `WHERE tenant_id = $1 AND id < $cursor
// ORDER BY id DESC LIMIT n`, served by the primary key: no OFFSET, stable while rows are added,
// and the same cost on page 1 and page 1000.
import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Untrusted page parameters, e.g. from a query string. */
export const pageRequestSchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export type PageRequest = z.input<typeof pageRequestSchema>;

export type PageOrder = 'newest' | 'oldest';

export interface Page<T> {
  readonly items: T[];
  /** Pass back as `cursor` to get the next page; null on the last page. */
  readonly nextCursor: string | null;
}

/** The cursor is malformed or was not issued by this module. */
export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid page cursor');
    this.name = 'InvalidCursorError';
  }
}

const cursorSchema = z.object({ v: z.literal(1), id: z.uuid() }).strict();

/**
 * Opaque to clients. It holds only the id of the last row the caller already received, so a
 * cursor replayed in another tenant's scope just filters that tenant's rows by id: it reveals
 * nothing and grants nothing.
 */
export function encodeCursor(id: string): string {
  const payload = cursorSchema.parse({ v: 1, id });
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) {
    throw new InvalidCursorError();
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  const result = cursorSchema.safeParse(decoded);
  if (!result.success) {
    throw new InvalidCursorError();
  }
  return result.data.id;
}

/** Arguments for one keyset query; spread into a Prisma findMany together with a where. */
export interface KeysetArgs {
  readonly take: number;
  readonly orderBy: { readonly id: 'asc' | 'desc' };
  /** Rows after the cursor in page order (empty on the first page); merge into the where. */
  readonly cursorWhere: { readonly id?: { lt: string } | { gt: string } };
}

/**
 * Runs one page query. `fetch` must merge `cursorWhere` into its where and pass `orderBy` and
 * `take` unchanged (one extra row is requested to learn whether another page exists).
 */
export async function paginate<T extends { readonly id: string }>(
  request: PageRequest,
  fetch: (args: KeysetArgs) => Promise<T[]>,
  order: PageOrder = 'newest',
): Promise<Page<T>> {
  const { limit, cursor } = pageRequestSchema.parse(request);
  const after = cursor === undefined ? undefined : decodeCursor(cursor);
  const desc = order === 'newest';
  const rows = await fetch({
    take: limit + 1,
    orderBy: { id: desc ? 'desc' : 'asc' },
    cursorWhere:
      after === undefined ? {} : { id: desc ? { lt: after } : { gt: after } },
  });
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last !== undefined ? encodeCursor(last.id) : null,
  };
}
