/**
 * The only auth surface the rest of this codebase may use.
 *
 * Five functions, and nothing that mentions Better Auth in its signature. An
 * ESLint rule (see `apps/api/eslint.config.js`) refuses any import of
 * `better-auth` or of `./config.js` from outside this directory, so the
 * boundary is enforced rather than asked for.
 *
 * That matters for a specific reason from TECH_STACK.md §6: an auth library is
 * the dependency most likely to need replacing, and the cost of replacing it is
 * decided *now*, by how many files know its name. One file knows. Swapping the
 * implementation means rewriting `config.ts` and this file, and touching
 * nothing else.
 *
 * The types below are ours — `Actor` comes from `@aura/core`, the same type
 * `can()` takes — so a replacement library has to satisfy our shape rather than
 * leaking its own through the application.
 */

import type { Actor, Role } from '@aura/core';
import { prisma } from '@aura/db';
import type { NextFunction, Request, Response } from 'express';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';

import { auth } from './config.js';

/** A request that has passed {@link requireAuth}. */
export type AuthenticatedRequest = Request & { actor: Actor };

/**
 * Express augmentation, deliberately optional.
 *
 * `req.actor` is `Actor | undefined` on a plain `Request`, so reading it
 * without going through `requireAuth` does not typecheck as an `Actor`. W3-05
 * makes the narrowing after the middleware non-optional; this declaration is
 * what gives it something to narrow *from*.
 */
declare module 'express-serve-static-core' {
  interface Request {
    actor?: Actor;
  }
}

/**
 * Resolve the actor for a request, or `null` if there is no valid session.
 *
 * Reads only the session cookie. Nothing here trusts a header, a body field or
 * a query parameter to say who the caller is — which is precisely what the
 * prototype did, with a hardcoded `emp-123` standing in for all of it
 * (PLAN.md F-02).
 */
export async function getActor(req: Request): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

  if (session === null) {
    return null;
  }

  /*
   * The session carries identity; the database carries authority.
   *
   * Roles and status are re-read here rather than taken from the session
   * payload, because a session issued before a demotion or a deactivation
   * would otherwise keep the old permissions until it expired — up to seven
   * days of access someone has already had removed (PRD US-106).
   */
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, orgId: true, roles: true, status: true },
  });

  if (user === null) {
    return null;
  }

  return {
    userId: user.id,
    orgId: user.orgId,
    roles: user.roles,
    isActive: user.status === 'ACTIVE',
  };
}

/**
 * Reject a request that has no valid session.
 *
 * 401 with a fixed body. No detail about whether the session was missing,
 * expired or belonged to a deactivated user — each of those is a fact about
 * an account that an unauthenticated caller has not earned.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const actor = await getActor(req);

      if (actor === null) {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }

      req.actor = actor;
      next();
    } catch (error) {
      next(error);
    }
  })();
}

/**
 * Require that the actor holds at least one of `roles`.
 *
 * A coarse gate for whole routers — "this section is HR only". It is **not** a
 * substitute for `can()` from `@aura/core`, which is what decides whether this
 * particular actor may act on this particular resource. Role alone cannot
 * answer that: an HR admin may view any sheet in the org and still may not
 * write someone else's self-appraisal.
 */
export function requireRole(...roles: readonly Role[]) {
  return function roleGuard(req: Request, res: Response, next: NextFunction): void {
    const actor = req.actor;

    if (actor === undefined) {
      // requireAuth has not run. A programming error, not a client error --
      // answering 403 would hide a broken route behind a plausible response.
      next(new Error('requireRole was used without requireAuth ahead of it.'));
      return;
    }

    if (!actor.roles.some((held) => roles.includes(held))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}

/** Issue a session for an existing user. Returns the `Set-Cookie` headers. */
export async function createSession(email: string, password: string): Promise<Headers> {
  const result = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });

  return result.headers;
}

/**
 * Revoke the caller's session server-side.
 *
 * Server-side, not merely by clearing the cookie: a logout that only forgets
 * the cookie leaves a valid session behind, so anyone who captured it stays
 * signed in.
 */
export async function revokeSession(req: Request): Promise<void> {
  await auth.api.signOut({ headers: fromNodeHeaders(req.headers) });
}

/**
 * A request handler for the auth library's own routes, ready to mount.
 *
 * A handler rather than the auth instance itself, on purpose. Exporting the
 * instance so `server.ts` could call `toNodeHandler(auth)` would put
 * `better-auth` back in a second file and make this whole boundary decorative
 * — the handler is built here and mounted there.
 */
export const authRoutes = toNodeHandler(auth);

export type { Actor, Role } from '@aura/core';
