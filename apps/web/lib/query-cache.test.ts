import { describe, expect, it, vi } from 'vitest';
import { EMPTY_ENTRY, QueryCache, queryKey } from './query-cache';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const WS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const membersKey = (userId: string, workspaceId: string) =>
  queryKey({
    userId,
    scope: { kind: 'workspace', workspaceId },
    resource: 'members',
    endpointId: 'members.list',
    request: `/workspaces/${workspaceId}/members?limit=50`,
  });

/** A loader whose answer the test releases. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('query cache keys (task 05B)', () => {
  it('carry the user and the workspace, so equal requests of others never collide', () => {
    expect(membersKey(ALICE, WS_A)).not.toBe(membersKey(ALICE, WS_B));
    expect(membersKey(ALICE, WS_A)).not.toBe(membersKey(BOB, WS_A));
    expect(membersKey(ALICE, WS_A)).toBe(membersKey(ALICE, WS_A));
  });

  it('refuse a resource in the wrong scope', () => {
    expect(() =>
      queryKey({
        userId: ALICE,
        scope: { kind: 'user' },
        resource: 'members',
        endpointId: 'members.list',
        request: '/x',
      }),
    ).toThrow(/workspace-scoped/);
    expect(() =>
      queryKey({
        userId: ALICE,
        scope: { kind: 'workspace', workspaceId: WS_A },
        resource: 'workspaces',
        endpointId: 'workspaces.list',
        request: '/workspaces',
      }),
    ).toThrow(/user-scoped/);
  });
});

describe('QueryCache', () => {
  it('loads once for concurrent subscribers and notifies them', async () => {
    const cache = new QueryCache();
    const key = membersKey(ALICE, WS_A);
    const listener = vi.fn();
    cache.subscribe(key, listener);
    const loader = vi.fn(() => Promise.resolve({ items: [1] }));
    await Promise.all([cache.load(key, loader), cache.load(key, loader)]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.get(key)).toMatchObject({
      status: 'success',
      data: { items: [1] },
      stale: false,
      fetching: false,
    });
    expect(listener).toHaveBeenCalled();
  });

  it('invalidates only the named resources of the named workspace and user', async () => {
    const cache = new QueryCache();
    const a = membersKey(ALICE, WS_A);
    const b = membersKey(ALICE, WS_B);
    const bob = membersKey(BOB, WS_A);
    for (const key of [a, b, bob]) {
      await cache.load(key, () => Promise.resolve('data'));
    }
    expect(
      cache.invalidate(ALICE, { kind: 'workspace', workspaceId: WS_A }, [
        'members',
      ]),
    ).toBe(1);
    expect(cache.get(a)?.stale).toBe(true);
    expect(cache.get(b)?.stale).toBe(false);
    expect(cache.get(bob)?.stale).toBe(false);
    // Other resources of the same workspace are untouched.
    expect(
      cache.invalidate(ALICE, { kind: 'workspace', workspaceId: WS_B }, [
        'invitations',
      ]),
    ).toBe(0);
    // A user-scope invalidation never reaches workspace entries.
    expect(cache.invalidate(ALICE, { kind: 'user' }, ['members'])).toBe(0);
  });

  it('marks an answer stale when the data changed while it was loading', async () => {
    const cache = new QueryCache();
    const key = membersKey(ALICE, WS_A);
    const slow = deferred<string>();
    const loading = cache.load(key, () => slow.promise);
    cache.invalidate(ALICE, { kind: 'workspace', workspaceId: WS_A }, [
      'members',
    ]);
    slow.resolve('before the change');
    await loading;
    expect(cache.get(key)).toMatchObject({
      status: 'success',
      data: 'before the change',
      stale: true,
    });
  });

  it('drops answers that arrive after clear(), and keeps subscribers for the next load', async () => {
    const cache = new QueryCache();
    const key = membersKey(ALICE, WS_A);
    const listener = vi.fn();
    cache.subscribe(key, listener);
    const slow = deferred<string>();
    const loading = cache.load(key, () => slow.promise);
    cache.clear();
    expect(cache.get(key)).toBe(EMPTY_ENTRY);
    slow.resolve('signed-out data');
    await loading;
    expect(cache.get(key)).toBe(EMPTY_ENTRY);
    // The subscriber still hears about the next load.
    listener.mockClear();
    await cache.load(key, () => Promise.resolve('fresh'));
    expect(listener).toHaveBeenCalled();
    expect(cache.get(key)?.data).toBe('fresh');
  });

  it('forgets entries nobody watches on clear()', async () => {
    const cache = new QueryCache();
    await cache.load(membersKey(ALICE, WS_A), () => Promise.resolve(1));
    expect(cache.size).toBe(1);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('keeps the last data on failure, and a forced retry replaces an older load', async () => {
    const cache = new QueryCache();
    const key = membersKey(ALICE, WS_A);
    await cache.load(key, () => Promise.resolve('first'));
    await cache.load(key, () => Promise.reject(new Error('down')), true);
    expect(cache.get(key)).toMatchObject({ status: 'error', data: 'first' });

    const old = deferred<string>();
    const first = cache.load(key, () => old.promise, true);
    await cache.load(key, () => Promise.resolve('newer'), true);
    old.resolve('older');
    await first;
    expect(cache.get(key)?.data).toBe('newer');
  });

  it('evicts unwatched entries beyond its size, oldest first', async () => {
    const cache = new QueryCache(2);
    const keys = [WS_A, WS_B, '33333333-3333-4333-8333-333333333333'].map(
      (ws) => membersKey(ALICE, ws),
    );
    cache.subscribe(keys[0] ?? '', () => undefined);
    for (const key of keys) {
      await cache.load(key, () => Promise.resolve(key));
    }
    expect(cache.size).toBe(2);
    expect(cache.get(keys[0] ?? '')).toBeDefined();
    expect(cache.get(keys[1] ?? '')).toBeUndefined();
  });
});
