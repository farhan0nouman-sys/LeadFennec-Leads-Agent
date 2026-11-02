'use client';

// The signed-in user, from GET /auth/session (task 04C). The session cookie is HttpOnly; the
// CSRF token for mutations lives only in this React state, never in storage or logs.
import { API, type SessionResponse } from '@lead-fennec-ai/shared';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, callApi } from './api';
import { loginPath } from './links';

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'signed_out';
      /** The session timed out (rather than: never signed in, or signed out). */
      readonly expired: boolean;
      /** The user signed out here: go to the sign-in page without a return path. */
      readonly byUser: boolean;
    }
  | { readonly status: 'signed_in'; readonly session: SessionResponse };

interface SessionContextValue {
  readonly state: SessionState;
  readonly reload: () => Promise<void>;
  readonly signedIn: (session: SessionResponse) => void;
  readonly signOut: () => Promise<void>;
  /**
   * For errors from API calls: when the session is gone (401), switches to signed-out, which
   * sends protected pages to the sign-in page. Returns true when it handled the error.
   */
  readonly handleAuthError: (error: unknown) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function fetchSession(): Promise<SessionState> {
  try {
    const session = await callApi(API.auth.session);
    return { status: 'signed_in', session };
  } catch (error) {
    return error instanceof ApiError && error.status === 401
      ? {
          status: 'signed_out',
          expired: error.code === 'session_expired',
          byUser: false,
        }
      : { status: 'unavailable' };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const reload = useCallback(async () => {
    setState(await fetchSession());
  }, []);

  useEffect(() => {
    let active = true;
    void fetchSession().then((next) => {
      if (active) {
        setState(next);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const signedIn = useCallback((session: SessionResponse) => {
    setState({ status: 'signed_in', session });
  }, []);

  const signOut = useCallback(async () => {
    const csrfToken =
      state.status === 'signed_in' ? state.session.csrfToken : undefined;
    try {
      await callApi(API.auth.logout, {}, { csrfToken });
    } catch {
      // The session may already have ended; the user is signed out here either way.
    }
    setState({ status: 'signed_out', expired: false, byUser: true });
  }, [state]);

  const handleAuthError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.unauthenticated) {
      setState({
        status: 'signed_out',
        expired: error.code === 'session_expired',
        byUser: false,
      });
      return true;
    }
    return false;
  }, []);

  const value = useMemo(
    () => ({ state, reload, signedIn, signOut, handleAuthError }),
    [state, reload, signedIn, signOut, handleAuthError],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return value;
}

/**
 * For pages that need a signed-in user: the session, or null while loading or redirecting.
 * Signed-out visitors go to the sign-in page and come back here afterwards.
 */
export function useRequiredSession(): SessionResponse | null {
  const { state } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status !== 'signed_out') {
      return;
    }
    router.replace(
      state.byUser
        ? '/login'
        : loginPath(
            pathname + window.location.search,
            state.expired ? 'expired' : undefined,
          ),
    );
  }, [state, router, pathname]);

  return state.status === 'signed_in' ? state.session : null;
}
