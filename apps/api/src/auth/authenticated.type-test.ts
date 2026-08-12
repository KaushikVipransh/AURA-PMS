/**
 * A compile-time proof, in the absence of `tsd`.
 *
 * This file has no runtime assertions and no tests. It exists to be
 * **typechecked**: `pnpm verify` runs `tsc --noEmit` over it, so if the
 * narrowing in `authenticated()` ever stops working, the build fails here
 * rather than a handler quietly reading `undefined.orgId` in production.
 *
 * The negative cases — the things that must NOT compile — are written as
 * `@ts-expect-error`, which is itself an assertion: if the error stops
 * occurring, TypeScript reports the unused directive and the build fails. That
 * is the part a runtime test cannot do at all.
 */

import type { Actor } from '@aura/core';
import type { Request } from 'express';

import { authenticated, type AuthedRequest } from './authenticated.js';

/* ------------------------------------------------------------------ *
 * Positive: inside an authenticated handler, `actor` needs no guard.  *
 * ------------------------------------------------------------------ */

authenticated((req) => {
  // No `?.`, no `!`, no narrowing. If this ever needs one, the guarantee is
  // gone and this line stops compiling.
  const orgId: string = req.actor.orgId;
  const userId: string = req.actor.userId;
  const roles: readonly string[] = req.actor.roles;
  const active: boolean = req.actor.isActive;

  void [orgId, userId, roles, active];
});

/** The wrapped result is an ordinary Express handler, mountable anywhere. */
const asRequestHandler: (req: Request, res: never, next: never) => void = authenticated(() => {
  /* empty */
});
void asRequestHandler;

/* ------------------------------------------------------------------ *
 * Negative: the mistakes this design exists to prevent.              *
 * ------------------------------------------------------------------ */

declare const plainRequest: Request;
declare const authedRequest: AuthedRequest;

// A plain request's actor is optional, so reading it as an Actor is an error.
// @ts-expect-error `actor` is possibly undefined on a plain Request.
const leaked: Actor = plainRequest.actor;
void leaked;

// @ts-expect-error the whole point: no unguarded property access off it either.
const leakedOrg: string = plainRequest.actor.orgId;
void leakedOrg;

// An AuthedRequest is a Request, so it may be passed anywhere one is expected.
const widened: Request = authedRequest;
void widened;

// ...but not the reverse. A plain Request cannot stand in for an authed one,
// which is what stops an unguarded route being wired to a guarded handler.
// @ts-expect-error a plain Request is missing the non-optional `actor`.
const narrowed: AuthedRequest = plainRequest;
void narrowed;

/*
 * One guarantee this design does NOT provide, established by trying to assert
 * it and failing.
 *
 * `AuthedRequest` is `Request & { actor: Actor }`, and Express's `Request`
 * declares `actor?: Actor` as mutable. An intersection cannot make a member
 * read-only that the other side declares writable, so a handler *can* reassign
 * `req.actor`. Marking it `readonly` in the intersection looked like it worked
 * until this file asserted it — the `@ts-expect-error` went unused, which
 * TypeScript reports, which failed the build.
 *
 * The `readonly` modifier has been removed rather than left in as decoration.
 * A type that claims a guarantee it does not enforce is worse than one that
 * claims nothing, because the next person will rely on it.
 */
declare const someOtherActor: Actor;
authedRequest.actor = someOtherActor;
