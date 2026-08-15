/**
 * Who the user is, according to the server (W6-04).
 *
 * **This is the client half of F-01.** The prototype's guard read
 * `localStorage.getItem('atomquest_role')` and compared it to a string, and its
 * login page wrote that value from a dropdown. Anyone could type
 * `localStorage.setItem('atomquest_role', 'admin')` into a console and become
 * an administrator — and because the API had no authentication at all, that was
 * the whole security model.
 *
 * The session here is an httpOnly cookie the browser cannot read. The identity
 * comes from `GET /auth/session`, which resolves it server-side against the
 * database on every call. **Nothing this file stores grants access to
 * anything**: clearing every byte of client storage changes nothing, because
 * the server was never consulting it.
 *
 * The session is a **query**, not a `useEffect` with a `useState` beside it.
 * The first draft was the latter, and it was worse in three ways: it fetched
 * again on every mount, it duplicated the retry policy that already exists in
 * `query.ts`, and it updated state from inside an effect — which React's own
 * lint rule flags, because it is how cascading re-renders start.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';

import { api, onUnauthenticated } from './api.js';
import {
  AuthContext,
  SESSION_QUERY_KEY,
  type AuthState,
  type SessionUser,
} from './auth-context.js';

type SessionResponse = { readonly user: SessionUser | null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => api.get<SessionResponse>('/auth/session'),
    /*
     * Never retried, and never treated as an error worth reporting.
     *
     * A 401 here is the expected answer for a signed-out visitor. Retrying it
     * twice delays the login page, and toasting it puts "Unauthenticated" on
     * screen for someone who simply has not signed in yet.
     */
    retry: false,
    staleTime: 60_000,
  });

  const forget = useCallback(() => {
    // Written straight into the cache rather than invalidated: an expired
    // session must stop being believed immediately, not after a refetch.
    queryClient.setQueryData<SessionResponse>(SESSION_QUERY_KEY, { user: null });
  }, [queryClient]);

  /* Registering a listener, not updating state -- the effect body returns the
     unsubscribe and the update happens later, when a 401 actually arrives. */
  useEffect(() => onUnauthenticated(forget), [forget]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await api.post('/auth/login', { email, password });
      // Refetched rather than read from the login response: the session
      // endpoint is the one source of identity, and a second one could
      // disagree with it.
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      // Cleared even if the request failed. A user who asked to be signed out
      // should not still see their own dashboard because the network blipped.
      forget();
      // Everything else in the cache belonged to that person.
      queryClient.clear();
    }
  }, [forget, queryClient]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({
      /* `?? null` covers both the error case and the not-yet-loaded one. Any
         failure to establish identity reads as signed out, which is the safe
         direction. */
      user: session.data?.user ?? null,
      loading: session.isPending,
      signIn,
      signOut,
      refresh,
    }),
    [session.data, session.isPending, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
