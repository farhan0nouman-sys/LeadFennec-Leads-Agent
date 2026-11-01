import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  MAX_PAGE_SIZE,
  paginate,
  type KeysetArgs,
} from './pagination.js';

/** An in-memory table queried the way Prisma would run the keyset arguments. */
function table(ids: string[]) {
  const calls: KeysetArgs[] = [];
  const fetch = (args: KeysetArgs) => {
    calls.push(args);
    const desc = args.orderBy.id === 'desc';
    const filter = args.cursorWhere.id;
    const rows = [...ids]
      .sort()
      .filter((id) =>
        filter === undefined
          ? true
          : 'lt' in filter
            ? id < filter.lt
            : id > filter.gt,
      );
    if (desc) {
      rows.reverse();
    }
    return Promise.resolve(rows.slice(0, args.take).map((id) => ({ id })));
  };
  return { fetch, calls };
}

// Ascending ids, like UUIDv7 created one after another.
const ids = Array.from(
  { length: 7 },
  (_, i) => `00000000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
);

describe('cursors', () => {
  it('round-trips an id', () => {
    const id = randomUUID();
    expect(decodeCursor(encodeCursor(id))).toBe(id);
  });

  it.each([
    ['not base64url', 'a+b/c='],
    ['not JSON', Buffer.from('nope').toString('base64url')],
    [
      'wrong version',
      Buffer.from(JSON.stringify({ v: 2, id: ids[0] })).toString('base64url'),
    ],
    [
      'not a uuid',
      Buffer.from(JSON.stringify({ v: 1, id: "1' OR '1'='1" })).toString(
        'base64url',
      ),
    ],
    [
      'extra keys',
      Buffer.from(
        JSON.stringify({ v: 1, id: ids[0], tenantId: ids[1] }),
      ).toString('base64url'),
    ],
    ['empty', ''],
    ['too long', 'a'.repeat(201)],
  ])('rejects a cursor that is %s', (_name, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
  });
});

describe('paginate', () => {
  it('walks every row once, newest first, and ends with a null cursor', async () => {
    const { fetch } = table(ids);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await paginate(
        cursor === undefined ? { limit: 3 } : { limit: 3, cursor },
        fetch,
      );
      seen.push(...page.items.map((r) => r.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
  });

  it('walks oldest first on request', async () => {
    const { fetch } = table(ids);
    const first = await paginate({ limit: 4 }, fetch, 'oldest');
    expect(first.items.map((r) => r.id)).toEqual(ids.slice(0, 4));
    const second = await paginate(
      { limit: 4, cursor: first.nextCursor ?? '' },
      fetch,
      'oldest',
    );
    expect(second.items.map((r) => r.id)).toEqual(ids.slice(4));
    expect(second.nextCursor).toBeNull();
  });

  it('asks for one extra row and never returns it', async () => {
    const { fetch, calls } = table(ids);
    const page = await paginate({ limit: 7 }, fetch);
    expect(calls[0]?.take).toBe(8);
    expect(page.items).toHaveLength(7);
    expect(page.nextCursor).toBeNull();
  });

  it('defaults to 25 rows and caps the page size', async () => {
    const { fetch, calls } = table(ids);
    await paginate({}, fetch);
    expect(calls[0]?.take).toBe(26);
    await expect(
      paginate({ limit: MAX_PAGE_SIZE + 1 }, fetch),
    ).rejects.toThrow();
    await expect(paginate({ limit: 0 }, fetch)).rejects.toThrow();
    // Query-string values arrive as text.
    await paginate({ limit: '5' }, fetch);
    expect(calls.at(-1)?.take).toBe(6);
  });

  it('rejects unknown parameters and bad cursors before querying', async () => {
    const { fetch, calls } = table(ids);
    await expect(
      paginate({ limit: 3, offset: 10 } as unknown as { limit: number }, fetch),
    ).rejects.toThrow();
    await expect(paginate({ cursor: 'garbage!' }, fetch)).rejects.toThrow(
      InvalidCursorError,
    );
    expect(calls).toHaveLength(0);
  });
});
