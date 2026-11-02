'use client';

// React side of the client cache (task 05B, docs/decisions.md D-05B-03): useApiQuery reads a
// cacheable endpoint, useApiMutation changes something and makes the endpoint's listed resources
// stale in the same scope. Keys carry the signed-in user's id and, for workspace data, the
// workspace id from the request path; signing out clears the cache.
import {
  CACHE_RESOURCES,
  type CacheableEndpoint,
  type EndpointInput,
  type EndpointResponse,
  type MutationEndpoint,
} from '@lead-fennec-ai/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ApiError, endpointRequest, sendRequest, type CallArgs } from './api';
import {
  afterPoll,
  nextPollDelay,
  POLL_RESUME,
  POLL_START,
  pollStop,
  type PollPolicy,
  type PollStop,
} from './polling';
import {
  EMPTY_ENTRY,
  QueryCache,
  queryKey,
  type CacheScope,
} from './query-cache';
import { useSession } from './session';

const CacheContext = createContext<QueryCache | null>(null);

/** One cache per browser tab; emptied whenever the signed-in user changes or signs out. */
export function ApiCacheProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [cache] = useState(() => new QueryCache());
  const { state } = useSession();
  const userId = state.status === 'signed_in' ? state.session.user.id : null;
  useEffect(
    () => () => {
      cache.clear();
    },
    [cache, userId],
  );
  return (
    <CacheContext.Provider value={cache}>{children}</CacheContext.Provider>
  );
}

function useCache(): QueryCache {
  const cache = useContext(CacheContext);
  if (cache === null) {
    throw new Error('API hooks must be used inside ApiCacheProvider');
  }
  return cache;
}

function scopeOf(
  resource: keyof typeof CACHE_RESOURCES,
  params: Readonly<Record<string, string>>,
): CacheScope {
  if (CACHE_RESOURCES[resource] === 'user') {
    return { kind: 'user' };
  }
  const workspaceId = params['workspaceId'];
  if (workspaceId === undefined) {
    throw new Error(`${resource} needs the workspace id in the path.`);
  }
  return { kind: 'workspace', workspaceId };
}

/** Automatic refreshes of a query with a `poll` policy (task 05C, D-05C-04). */
export interface PollingState {
  /** A refresh is scheduled: the page is visible and polling hasn't stopped. */
  readonly active: boolean;
  /** Why automatic refreshes stopped; null while they continue (or the page is hidden). */
  readonly stopped: PollStop | null;
  /** Refreshes now and starts automatic refreshes again. */
  readonly resume: () => void;
}

export type QueryResult<T> = (
  | {
      readonly status: 'loading';
      readonly data: undefined;
      readonly error: undefined;
      readonly refreshing: false;
      readonly retry: () => void;
    }
  | {
      readonly status: 'error';
      /** The last data loaded before the error, if any. */
      readonly data: T | undefined;
      readonly error: ApiError;
      readonly refreshing: boolean;
      readonly retry: () => void;
    }
  | {
      readonly status: 'success';
      readonly data: T;
      readonly error: undefined;
      /** Showing cached data while it loads again. */
      readonly refreshing: boolean;
      readonly retry: () => void;
    }
) & {
  /** Null unless the query was given a `poll` policy. */
  readonly polling: PollingState | null;
};

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener('visibilitychange', listener);
  return () => {
    document.removeEventListener('visibilitychange', listener);
  };
};

/** Whether the page is visible (the server renders as if it were). */
function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== 'hidden',
    () => true,
  );
}

const asApiError = (error: unknown) =>
  error instanceof ApiError
    ? error
    : new ApiError(
        0,
        'unexpected_response',
        'Something went wrong. Try again.',
      );

/**
 * Reads `endpoint` through the cache: shows cached data at once and loads it again when the
 * screen mounts, and at once when a mutation made it stale. A 401 sends the user to sign in.
 * Disabled until signed in. With `poll` (a module-level constant), it also loads again on that
 * policy's schedule while the page is visible, until the policy stops it (lib/polling.ts).
 */
export function useApiQuery<E extends CacheableEndpoint>(
  endpoint: E,
  input: EndpointInput<E>,
  options: { readonly enabled?: boolean; readonly poll?: PollPolicy } = {},
): QueryResult<EndpointResponse<E>> {
  const cache = useCache();
  const { state, handleAuthError } = useSession();
  const userId = state.status === 'signed_in' ? state.session.user.id : null;

  let key: string | null = null;
  let path = '';
  let inputError: ApiError | null = null;
  try {
    const request = endpointRequest(endpoint, input);
    path = request.path;
    if (userId !== null) {
      key = queryKey({
        userId,
        scope: scopeOf(endpoint.cache, request.params),
        resource: endpoint.cache,
        endpointId: endpoint.id,
        request: request.path,
      });
    }
  } catch (error) {
    inputError = asApiError(error);
  }
  const enabled = options.enabled !== false && key !== null;

  const subscribe = useCallback(
    (listener: () => void) =>
      key === null ? () => undefined : cache.subscribe(key, listener),
    [cache, key],
  );
  const entry = useSyncExternalStore(
    subscribe,
    () => (key === null ? EMPTY_ENTRY : (cache.get(key) ?? EMPTY_ENTRY)),
    () => EMPTY_ENTRY,
  );

  const load = useCallback(
    (force: boolean) => {
      if (key !== null) {
        // The validated path is the whole request: cacheable reads take no body or headers.
        void cache.load(key, () => sendRequest(endpoint, { path }), force);
      }
    },
    [cache, key, endpoint, path],
  );

  // A screen that mounts (or asks for other data) shows what the cache has and loads it again
  // in the background: changes made by other people reach it without a reload.
  useEffect(() => {
    if (enabled) {
      load(false);
    }
  }, [enabled, load]);

  // Data made stale while the screen is open (a mutation's invalidation) loads again at once.
  useEffect(() => {
    if (enabled && entry.stale && !entry.fetching) {
      load(false);
    }
  }, [enabled, entry.stale, entry.fetching, load]);

  useEffect(() => {
    if (entry.status === 'error') {
      handleAuthError(entry.error);
    }
  }, [entry.status, entry.error, handleAuthError]);

  // Polling (task 05C): only while the page is visible; coming back refreshes at once and
  // starts the policy's count again. A poll joins a load already in flight instead of adding one.
  const policy = options.poll;
  const visible = usePageVisible();
  const [progress, setProgress] = useState(POLL_START);
  const [seenVisible, setSeenVisible] = useState(visible);
  if (seenVisible !== visible) {
    setSeenVisible(visible);
    if (visible) {
      setProgress(POLL_RESUME);
    }
  }
  const delay =
    policy !== undefined && enabled && visible
      ? nextPollDelay(policy, progress)
      : null;
  useEffect(() => {
    if (delay === null || key === null) {
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void cache
        .load(key, () => sendRequest(endpoint, { path }), false)
        .then(() => {
          if (current) {
            const ok = cache.get(key)?.status === 'success';
            setProgress((before) => afterPoll(before, ok));
          }
        });
    }, delay);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `progress` restarts the timer after every poll, even when the delay stays the same.
  }, [delay, progress, key, cache, endpoint, path]);

  const retry = useCallback(() => {
    load(true);
    setProgress(POLL_START);
  }, [load]);

  const polling: PollingState | null =
    policy === undefined
      ? null
      : {
          active: delay !== null,
          stopped: visible ? pollStop(policy, progress) : null,
          resume: retry,
        };

  if (inputError !== null) {
    return {
      status: 'error',
      data: undefined,
      error: inputError,
      refreshing: false,
      retry,
      polling,
    };
  }
  if (entry.status === 'success') {
    return {
      status: 'success',
      data: entry.data as EndpointResponse<E>,
      error: undefined,
      refreshing: entry.fetching,
      retry,
      polling,
    };
  }
  if (entry.status === 'error' && !entry.fetching) {
    return {
      status: 'error',
      data: entry.data as EndpointResponse<E> | undefined,
      error: asApiError(entry.error),
      refreshing: false,
      retry,
      polling,
    };
  }
  return {
    status: 'loading',
    data: undefined,
    error: undefined,
    refreshing: false,
    retry,
    polling,
  };
}

export type MutationResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: ApiError;
      /** The session ended; the user is being sent to sign in. Nothing else to show. */
      readonly signedOut: boolean;
    };

/**
 * Changes something through `endpoint` with the session's CSRF token. On success the resources
 * the endpoint lists in `invalidates` become stale, in the workspace of the request's own path
 * (or the user's scope), so the screens showing them load again.
 */
export function useApiMutation<E extends MutationEndpoint>(
  endpoint: E,
): {
  readonly mutate: (
    ...args: CallArgs<E>
  ) => Promise<MutationResult<EndpointResponse<E>>>;
  readonly pending: boolean;
} {
  const cache = useCache();
  const { state, handleAuthError } = useSession();
  const [pending, setPending] = useState(false);
  const session = state.status === 'signed_in' ? state.session : null;

  const mutate = useCallback(
    async (
      ...[input, options]: CallArgs<E>
    ): Promise<MutationResult<EndpointResponse<E>>> => {
      setPending(true);
      try {
        const request = endpointRequest(endpoint, input ?? {});
        const data = await sendRequest(endpoint, request, {
          csrfToken: session?.csrfToken,
          ...options,
        });
        if (session !== null) {
          for (const resource of endpoint.invalidates ?? []) {
            cache.invalidate(
              session.user.id,
              scopeOf(resource, request.params),
              [resource],
            );
          }
        }
        return { ok: true, data };
      } catch (error) {
        const apiError = asApiError(error);
        return {
          ok: false,
          error: apiError,
          signedOut: handleAuthError(apiError),
        };
      } finally {
        setPending(false);
      }
    },
    [cache, endpoint, session, handleAuthError],
  );

  return { mutate, pending };
}
