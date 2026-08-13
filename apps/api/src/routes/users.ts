/**
 * Invite, accept, read and deactivate (PRD US-101, US-104, US-106).
 *
 * Every handler is wrapped in `authenticated()`, so `req.actor` and `req.db`
 * are non-optional inside them and the compiler enforces that the middleware
 * ran. Every authorisation decision goes through `can()` from `@aura/core` —
 * the same table W3-09's matrix reads, so a route and its test cannot hold
 * different opinions about who may do what.
 */

import { can, type Actor, type PolicyAction } from '@aura/core';
import { inviteUserRequestSchema } from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { auditActor, deactivateUser, inviteUser } from '../services/users.js';
import { parseBody } from '../validate.js';

/**
 * Read a path parameter as a single string.
 *
 * Express 5 types params as `string | string[]`, because a repeated segment
 * can produce an array. An id never should, and taking the first element
 * rather than joining means a crafted `/users/a/b` cannot smuggle a compound
 * value into a `where` clause.
 */
function pathParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];

  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

/** The request context an audit row records alongside the change. */
function requestContext(req: AuthedRequest): { ip: string | undefined; userAgent: string | undefined } {
  const userAgent = req.headers['user-agent'];

  return { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent : undefined };
}

export const usersRouter: Router = Router();

usersRouter.use(requireAuth);

/**
 * A missing record and a forbidden one answer identically: 404.
 *
 * A 403 confirms the row exists. Across an organization boundary that is an
 * existence oracle — "is bob@rival.example one of your customers" answered by
 * a status code (PRD US-105). Within an organization the distinction is
 * harmless, but making it uniform means nobody has to remember which case
 * they are in.
 */
function notFound(res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

/** Resolve the subject of a request, scoped, with its reporting chain. */
async function loadSubject(req: AuthedRequest, id: string) {
  // `req.db` is org-scoped, so a user in another organization simply is not
  // here — the filter is applied by the query pipeline, not by this handler.
  const user = await req.db.user.findUnique({
    where: { id },
    select: { id: true, orgId: true, name: true, email: true, roles: true, status: true, managerId: true, teamId: true },
  });

  if (user === null) {
    return null;
  }

  return { user, managerChainIds: await managerChain(req, user.managerId) };
}

/**
 * Walk the reporting line upwards.
 *
 * Bounded, because a cycle in the data would otherwise hang the request. The
 * schema's composite foreign key prevents a cross-org manager but nothing
 * prevents A→B→A, so the loop refuses to trust that it terminates.
 */
async function managerChain(req: AuthedRequest, managerId: string | null): Promise<string[]> {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = managerId;

  while (current !== null && !seen.has(current) && chain.length < 20) {
    seen.add(current);
    chain.push(current);

    const manager = await req.db.user.findUnique({
      where: { id: current },
      select: { managerId: true },
    });

    current = manager?.managerId ?? null;
  }

  return chain;
}

/** Ask the W2-06 table. One question, one answer, one place it is decided. */
function allows(actor: Actor, action: PolicyAction, subject: { orgId: string; id: string | null }, chain: readonly string[]): boolean {
  return can(actor, action, {
    orgId: subject.orgId,
    subjectUserId: subject.id,
    managerChainIds: chain,
  });
}

/** US-101 — invite by email, with a role and a manager decided at invite time. */
usersRouter.post(
  '/invite',
  authenticated(async (req, res) => {
    if (!allows(req.actor, 'INVITE_USER', { orgId: req.actor.orgId, id: null }, [])) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseBody(inviteUserRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const { name, email, role, managerId, teamId } = parsed.data;

    if ((await req.db.user.count({ where: { email } })) > 0) {
      res.status(409).json({ error: 'That email address is already registered' });
      return;
    }

    // Scoped, so a manager from another organization reads as absent rather
    // than as forbidden -- and the composite foreign key would reject it
    // anyway. Two independent guards, deliberately.
    if (managerId !== null && (await req.db.user.count({ where: { id: managerId } })) === 0) {
      res.status(400).json({ error: 'That manager is not part of this organization' });
      return;
    }

    const invited = await inviteUser(req.db, auditActor(req.actor, requestContext(req)), {
      name,
      email,
      role,
      managerId,
      teamId,
    });

    res.status(201).json({ user: invited });
  }),
);

/** Read one user. The route W3-06's cross-organization test drives. */
usersRouter.get(
  '/:id',
  authenticated(async (req, res) => {
    const id = pathParam(req.params, 'id');
    const found = await loadSubject(req, id);

    if (found === null) {
      notFound(res);
      return;
    }

    if (!allows(req.actor, 'VIEW_USER', found.user, found.managerChainIds)) {
      // 404, not 403. See `notFound`.
      notFound(res);
      return;
    }

    res.status(200).json({ user: found.user });
  }),
);

/**
 * US-106 — deactivate, never delete.
 *
 * A departing employee's history is what a disputed appraisal is settled from,
 * and `AuditEvent.actor` is `onDelete: Restrict` precisely so the row cannot be
 * removed out from under it. There is no delete endpoint, here or anywhere.
 */
usersRouter.post(
  '/:id/deactivate',
  authenticated(async (req, res) => {
    const id = pathParam(req.params, 'id');
    const found = await loadSubject(req, id);

    if (found === null) {
      notFound(res);
      return;
    }

    if (!allows(req.actor, 'DEACTIVATE_USER', found.user, found.managerChainIds)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // The update, the session revocation and the audit row commit together.
    const updated = await deactivateUser(req.db, auditActor(req.actor, requestContext(req)), id);

    res.status(200).json({ user: updated });
  }),
);
