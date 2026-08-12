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

import { scopedPrisma, type ScopedPrisma } from '../db/scoped.js';
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
    /**
     * A database client scoped to the actor's organization.
     *
     * Installed by `requireAuth`, so obtaining a client and having an actor
     * are the same event. A route cannot reach the unscoped singleton by
     * accident, because the only handle it is given is already narrowed.
     */
    db?: ScopedPrisma;
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
      // Scope and identity are installed together: there is no window in which
      // a handler has one without the other.
      req.db = scopedPrisma(actor.orgId);
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

/**
 * Create a credentialed user.
 *
 * The organization must already exist: `orgId` is NOT NULL with no default,
 * because a user with no organization is the shape PLAN.md F-02 allowed.
 * Roles and status are **not** parameters — they are server-owned and set by
 * the caller afterwards, so no request body can ever name a role.
 */
export async function createUser(input: {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly orgId: string;
}): Promise<void> {
  await auth.api.signUpEmail({ body: { ...input } });
}

/**
 * Issue a session for an existing user.
 *
 * Returns the actor alongside the cookies, because every caller needs both and
 * resolving the actor from a cookie that has not been sent yet is awkward
 * enough that the first draft did it by faking a `Request`.
 */
export async function createSession(
  email: string,
  password: string,
): Promise<{ headers: Headers; actor: Actor | null }> {
  const result = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });

  return {
    headers: result.headers,
    actor: await getActorByCookie(result.headers.getSetCookie().join('; ')),
  };
}

/** Resolve an actor from a raw cookie header. */
export async function getActorByCookie(cookie: string): Promise<Actor | null> {
  return getActor({ headers: { cookie } } as Request);
}

/**
 * Begin a password reset.
 *
 * Resolves whether or not the address exists. The caller must answer
 * identically either way — a "no such account" here is an oracle for who works
 * at this company (PRD US-103).
 */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo } });
  } catch {
    // Swallowed on purpose. Anything the library wants to say about an unknown
    // address is exactly what must not reach the client.
  }
}

/**
 * Complete a password reset.
 *
 * Returns whether the token was accepted rather than throwing, because "that
 * link has expired" is an ordinary outcome of a flow with a one-hour window.
 */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  try {
    await auth.api.resetPassword({ body: { token, newPassword } });
    return true;
  } catch {
    return false;
  }
}

/** Revoke a session identified by a raw cookie header. */
export async function revokeSessionByCookie(cookie: string): Promise<void> {
  await auth.api.signOut({ headers: new Headers({ cookie }) });
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
