/**
 * The route guard (W6-04).
 *
 * Replaces `ProtectedRoute`, which read a role out of `localStorage` and
 * compared it to a string (PLAN.md F-01). What it checks now is a server-backed
 * session; what it *does* is decide which screen to render, which is all a
 * client-side guard can honestly do. Every request behind it is authorised
 * again by the API.
 */

import type { Role } from '@aura/contracts';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { hasRole, useAuth } from '../lib/auth-context.js';

export function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  /** Optional. Absent means "any signed-in user". */
  roles?: readonly Role[];
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  /*
   * Rendering nothing while the first session check is in flight.
   *
   * Redirecting instead would bounce every signed-in user to the login page on
   * a hard refresh, because the cookie is only resolved by a round trip.
   */
  if (loading) {
    return <div role="status" aria-live="polite" className="p-8 text-sm">Checking your session…</div>;
  }

  if (user === null) {
    /* The path travels in state, so signing in returns you where you were
       going. A guard that always lands on the dashboard loses the link
       somebody sent you. */
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (roles !== undefined && !hasRole(user, ...roles)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
