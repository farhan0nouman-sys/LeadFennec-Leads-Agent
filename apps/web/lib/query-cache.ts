// The web app's client cache of API reads (task 05B, docs/decisions.md D-05B-03). Pure: no
// React, no fetch. Safety rules:
// - Every key carries the signed-in user's id and the data's scope: the workspace id taken from
//   the request's own path for workspace data, so one workspace's data is never served for, or
//   invalidated by, another.
// - Invalidation names a user, a scope and resources; it matches the stored fields of each entry,
//   never key prefixes.
// - clear() (sign-out, another user) drops everything, and answers still in flight are thrown
//   away when they arrive.
import { CACHE_RESOURCES, type CacheResource } from '@lead-fennec-ai/shared';

export type CacheScope =
  | { readonly kind: 'user' }
  | { readonly kind: 'workspace'; readonly workspaceId: string };

export interface QueryEntry {
  readonly status: 'idle' | 'success' | 'error';
  readonly data: unknown;
  readonly error: unknown;
  /** Never loaded, invalidated, or loaded while a change was being made: load again. */
  readonly stale: boolean;
  readonly fetching: boolean;
}

/** The entry of a key that has nothing yet; one shared object (stable for React). */
export const EMPTY_ENTRY: QueryEntry = Object.freeze({
  status: 'idle',
  data: undefined,
  error: undefined,
  stale: true,
  fetching: false,
});

interface KeyParts {
  readonly userId: string;
  readonly scope: CacheScope;
  readonly resource: CacheResource;
  readonly endpointId: string;
  /** The request path with its query string, as sent. */
  readonly request: string;
}

interface Slot extends KeyParts {
  entry: QueryEntry;
  readonly listeners: Set<() => void>;
  /** Raised by each load and by clear(); an answer for an older value is dropped. */
  generation: number;
  /** Invalidated while a load was in flight: that load's answer is stale on arrival. */
  invalidatedInFlight: boolean;
  inFlight: Promise<void> | null;
}

/** The cache key: canonical JSON of the parts, so it can be compared and parsed back. */
export function queryKey(parts: KeyParts): string {
  if (CACHE_RESOURCES[parts.resource] !== parts.scope.kind) {
    throw new Error(
      `Resource ${parts.resource} is ${CACHE_RESOURCES[parts.resource]}-scoped.`,
    );
  }
  return JSON.stringify([
    parts.userId,
    parts.scope.kind,
    parts.scope.kind === 'workspace' ? parts.scope.workspaceId : '',
    parts.resource,
    parts.endpointId,
    parts.request,
  ]);
}

function parseKey(key: string): KeyParts {
  const [userId, kind, workspaceId, resource, endpointId, request] = JSON.parse(
    key,
  ) as [string, string, string, CacheResource, string, string];
  return {
    userId,
    scope: kind === 'workspace' ? { kind, workspaceId } : { kind: 'user' },
    resource,
    endpointId,
    request,
  };
}

const sameScope = (a: CacheScope, b: CacheScope) =>
  a.kind === b.kind &&
  (a.kind === 'user' ||
    (b.kind === 'workspace' && a.workspaceId === b.workspaceId));

export class QueryCache {
  readonly #slots = new Map<string, Slot>();

  /** @param maxEntries entries without subscribers beyond this are dropped, oldest first. */
  constructor(private readonly maxEntries = 200) {}

  get(key: string): QueryEntry | undefined {
    return this.#slots.get(key)?.entry;
  }

  #slot(key: string): Slot {
    let slot = this.#slots.get(key);
    if (slot === undefined) {
      slot = {
        ...parseKey(key),
        entry: EMPTY_ENTRY,
        listeners: new Set(),
        generation: 0,
        invalidatedInFlight: false,
        inFlight: null,
      };
      this.#slots.set(key, slot);
    }
    return slot;
  }

  #set(slot: Slot, entry: QueryEntry): void {
    slot.entry = entry;
    for (const listener of [...slot.listeners]) {
      listener();
    }
  }

  subscribe(key: string, listener: () => void): () => void {
    const slot = this.#slot(key);
    slot.listeners.add(listener);
    return () => {
      slot.listeners.delete(listener);
    };
  }

  /**
   * Loads `key` with `loader` unless a load is already running (then joins it). `force` starts a
   * new load anyway (retry); the older answer is then ignored.
   */
  load(
    key: string,
    loader: () => Promise<unknown>,
    force = false,
  ): Promise<void> {
    const slot = this.#slot(key);
    if (slot.inFlight !== null && !force) {
      return slot.inFlight;
    }
    slot.generation += 1;
    const generation = slot.generation;
    slot.invalidatedInFlight = false;
    this.#set(slot, { ...slot.entry, fetching: true });
    const settle = (entry: Omit<QueryEntry, 'fetching' | 'stale'>) => {
      // Cleared, or replaced by a newer load meanwhile: this answer is out of date.
      if (this.#slots.get(key) !== slot || slot.generation !== generation) {
        return;
      }
      slot.inFlight = null;
      this.#set(slot, {
        ...entry,
        fetching: false,
        stale: slot.invalidatedInFlight,
      });
      this.#evict();
    };
    const run = loader().then(
      (data) => {
        settle({ status: 'success', data, error: undefined });
      },
      (error: unknown) => {
        settle({ status: 'error', data: slot.entry.data, error });
      },
    );
    slot.inFlight = run;
    return run;
  }

  /**
   * Marks the user's `resources` in `scope` stale; subscribers load them again. Entries of other
   * users and other workspaces are not touched. Returns how many entries were marked.
   */
  invalidate(
    userId: string,
    scope: CacheScope,
    resources: readonly CacheResource[],
  ): number {
    let count = 0;
    for (const slot of this.#slots.values()) {
      if (
        slot.userId !== userId ||
        !sameScope(slot.scope, scope) ||
        !resources.includes(slot.resource)
      ) {
        continue;
      }
      count += 1;
      if (slot.inFlight !== null) {
        slot.invalidatedInFlight = true;
      }
      this.#set(slot, { ...slot.entry, stale: true });
    }
    return count;
  }

  /** Drops all data (sign-out); subscribers start over. Answers in flight are discarded. */
  clear(): void {
    for (const [key, slot] of [...this.#slots]) {
      slot.generation += 1;
      slot.inFlight = null;
      slot.invalidatedInFlight = false;
      if (slot.listeners.size === 0) {
        this.#slots.delete(key);
      } else {
        // Kept only so mounted subscribers hear about their next load.
        this.#set(slot, EMPTY_ENTRY);
      }
    }
  }

  /** Number of entries (tests). */
  get size(): number {
    return this.#slots.size;
  }

  #evict(): void {
    if (this.#slots.size <= this.maxEntries) {
      return;
    }
    for (const [key, slot] of this.#slots) {
      if (this.#slots.size <= this.maxEntries) {
        break;
      }
      if (slot.listeners.size === 0 && slot.inFlight === null) {
        this.#slots.delete(key);
      }
    }
  }
}
