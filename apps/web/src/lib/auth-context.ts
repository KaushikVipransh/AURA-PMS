/**
 * The auth context, its hook, and the role helper (W6-04).
 *
 * Separate from `auth.tsx`, which holds the provider component. Splitting them
 * is not ceremony: a module that exports both a component and plain functions
 * breaks React Fast Refresh, so editing `hasRole` would force a full reload and
 * lose whatever state you were debugging.
 */

import type { Role } from '@aura/contracts';
import { createContext, useContext } from 'react';

export type SessionUser = {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly Role[];
  readonly timeZone: string;
};

/**
 * Declared as properties holding functions, not as method shorthand.
 *
 * They are closures over provider state, and destructuring one off the object
 * — which every consumer does — must not change what it means. Method
 * shorthand would type them as methods bound to `this`, which they are not.
 */
export type AuthState = {
  readonly user: SessionUser | null;
  /** True until the first session check resolves. */
  readonly loading: boolean;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);

/** The cache key for the session, named once so nothing can mistype it. */
export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

/**
 * Whether the user holds a role.
 *
 * A helper rather than a comparison at each call site, because `roles` is a
 * list — an HR administrator is usually also an employee with their own goal
 * sheet, and the prototype's single-string role could not express that.
 *
 * **This decides what to render, never what is permitted.** The server asks
 * `can()` on every request regardless; hiding a button the API would refuse is
 * a courtesy, and treating it as the check is F-01.
 */
export function hasRole(user: SessionUser | null, ...roles: readonly Role[]): boolean {
  return user !== null && roles.some((role) => user.roles.includes(role));
}

/** The current session. Throws outside a provider, rather than returning null. */
export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (context === null) {
    // A hook that returned a null user outside its provider would render the
    // signed-out view on a page that is merely wired up wrong.
    throw new Error('useAuth must be used inside an AuthProvider.');
  }

  return context;
}
