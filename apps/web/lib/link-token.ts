// Tokens from emailed links (client components only: reads the address bar).
import { useEffect, useState } from 'react';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Reads `#token=…` from the address bar and removes the fragment, so the token is not left in
 * the visible URL or the history. The fragment never reaches a server. Returns null when there
 * is no well-formed token.
 */
export function takeFragmentToken(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('token');
  if (window.location.hash !== '') {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
  }
  return token !== null && TOKEN.test(token) ? token : null;
}

function readStored(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    return value !== null && TOKEN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves (or with null, removes) a link token for this tab only. */
export function rememberLinkToken(key: string, token: string | null): void {
  try {
    if (token === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, token);
    }
  } catch {
    // Storage unavailable: the link has to be opened again later.
  }
}

/**
 * The token of the emailed link this page was opened from: undefined until read (the server
 * can't see the fragment), null when there is none. With `storageKey`, the token is kept in
 * this tab's sessionStorage, so it survives signing in, and used when the link has none.
 */
export function useLinkToken(storageKey?: string): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const read = () => {
      const fromLink = takeFragmentToken();
      if (storageKey !== undefined && fromLink !== null) {
        rememberLinkToken(storageKey, fromLink);
      }
      setToken(
        fromLink ?? (storageKey === undefined ? null : readStored(storageKey)),
      );
    };
    // The address bar after hydration (the server never sees the fragment), and again when
    // another link opens in the same page (a fragment-only navigation does not reload it).
    read();
    window.addEventListener('hashchange', read);
    return () => {
      window.removeEventListener('hashchange', read);
    };
  }, [storageKey]);
  return token;
}
