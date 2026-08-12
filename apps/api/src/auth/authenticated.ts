/**
 * Making "this handler runs authenticated" a fact the compiler knows.
 *
 * `req.actor` is optional on a plain `Request`, which is correct — most
 * requests have no actor. But that optionality then follows every guarded
 * handler around, and the natural way to silence it is `req.actor!`, which is
 * a promise the type system cannot check and which is wrong the first time
 * someone mounts the handler without the middleware.
 *
 * `authenticated()` closes that: it takes a handler whose request has a
 * **non-optional** `actor` and returns an ordinary Express handler. The
 * narrowing happens in one place, guarded by a real runtime check, so a
 * downstream handler that forgets `requireAuth` is a **compile error** rather
 * than a `undefined.orgId` at runtime — which, in a system whose whole tenancy
 * story rests on `actor.orgId`, is a data leak (PLAN.md F-02).
 */

import type { Actor } from '@aura/core';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { ScopedPrisma } from '../db/scoped.js';

/**
 * A request the compiler knows has an actor *and* a scoped database client.
 *
 * Both together, because they are installed together. A handler that can reach
 * `req.db` has, by construction, an `actor` whose organization narrowed it.
 */
export type AuthedRequest = Request & { actor: Actor; db: ScopedPrisma };

export type AuthedHandler = (
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

/**
 * Wrap a handler that requires an actor.
 *
 * The runtime check is not redundant with `requireAuth`. It is what makes the
 * type assertion below honest: without it, `authenticated()` would be asserting
 * something it has not verified, which is exactly the `!` this exists to
 * replace. Reaching it means a router was assembled wrongly, so it answers 500
 * — a 401 would describe the caller's request, and the caller did nothing.
 */
export function authenticated(handler: AuthedHandler): RequestHandler {
  return function authenticatedHandler(req: Request, res: Response, next: NextFunction): void {
    if (req.actor === undefined || req.db === undefined) {
      next(
        new Error(
          'A handler wrapped in authenticated() ran without requireAuth ahead of it. ' +
            'This is a routing mistake, not a client error.',
        ),
      );
      return;
    }

    void Promise.resolve(handler(req as AuthedRequest, res, next)).catch(next);
  };
}
