'use client';

// Hooks behind list pages (task 05B): the URL-backed search and filters, and the trail of
// cursors that makes "Previous" possible with the API's keyset pagination.
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { z } from 'zod';
import { listParamsQuery, parseListParams } from './list-params';

const EMPTY = new URLSearchParams();

/**
 * The list's values from the address (validated, defaults filled in), `update` to change some
 * (replacing the history entry), and whether anything differs from the defaults.
 */
export function useListParams<S extends z.ZodObject>(schema: S) {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const values = parseListParams(schema, search);
  const defaults = parseListParams(schema, EMPTY);

  const go = (next: Readonly<Record<string, unknown>>) => {
    const query = listParamsQuery(next, defaults);
    router.replace(query === '' ? pathname : `${pathname}?${query}`, {
      scroll: false,
    });
  };

  return {
    values,
    /** A key that changes whenever the view changes (reset paging on it). */
    viewKey: listParamsQuery(values, defaults),
    filtered: listParamsQuery(values, defaults) !== '',
    update: (patch: Partial<z.output<S>>) => {
      go({ ...values, ...patch });
    },
    clear: () => {
      go(defaults);
    },
  };
}

/**
 * The cursors of the pages before the current one. `resetKey` names the view (filters, page
 * size); when it changes, paging starts again from the first page.
 */
export function useCursorTrail(resetKey: string) {
  const [state, setState] = useState<{
    readonly key: string;
    readonly trail: readonly string[];
  }>({ key: resetKey, trail: [] });
  const trail = state.key === resetKey ? state.trail : [];
  return {
    /** The current page's cursor; undefined for the first page. */
    cursor: trail.at(-1),
    page: trail.length + 1,
    hasPrevious: trail.length > 0,
    next: (cursor: string) => {
      setState({ key: resetKey, trail: [...trail, cursor] });
    },
    previous: () => {
      setState({ key: resetKey, trail: trail.slice(0, -1) });
    },
    reset: () => {
      setState({ key: resetKey, trail: [] });
    },
  };
}
