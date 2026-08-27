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
import { importUsersRequestSchema, inviteUserRequestSchema, listUsersQuerySchema } from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { reportingChain } from '../services/orgchart.js';
import { auditActor, deactivateUser, inviteUser } from '../services/users.js';
import { commitImport, planImport } from '../services/userImport.js';
import { parseBody, parseQuery } from '../validate.js';

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

  /*
   * One `WITH RECURSIVE` query rather than a `findUnique` per rung (W4-04).
   * The bound and the cycle guard did not go away -- they moved into the SQL,
   * where `A -> B -> A` would otherwise not merely hang a request but fail to
   * terminate at all.
   */
  return {
    user,
    managerChainIds: await reportingChain(req.db, req.actor.orgId, user.id),
  };
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

/**
 * US-101 — everyone in the organization, for the administration screen.
 *
 * Registered before `/:id`, which would otherwise claim the empty path's
 * sibling routes — Express matches in registration order, and `/users/import`
 * arriving at the read-one handler as a user called "import" is the same trap
 * `GET /queue` avoided by taking its own prefix.
 *
 * `VIEW_USER` is asked once, against the organization rather than a person.
 * That is honest for a list: it is the same question `ANYONE_IN_ORG` answers,
 * and asking it per row would return a half-list that no page could paginate.
 * A manager therefore gets 403 here and uses `/org-chart`, which is scoped to
 * their line by construction.
 */
usersRouter.get(
  '/',
  authenticated(async (req, res) => {
    if (!allows(req.actor, 'VIEW_USER', { orgId: req.actor.orgId, id: null }, [])) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseQuery(listUsersQuerySchema, req.query);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const query = parsed.data;

    const rows = await req.db.user.findMany({
      where: {
        ...(query.role === undefined ? {} : { roles: { has: query.role } }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.managerId === undefined ? {} : { managerId: query.managerId }),
        /* Case-insensitive on both columns. Searching a roster for "priya" and
           being told there is no such person because the row says "Priya" is
           the kind of thing that makes people stop using the search box. */
        ...(query.search === undefined
          ? {}
          : {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { email: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }),
      },
      // One past the page, so "is there more" is answered without a second
      // count over the same predicate.
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        orgId: true,
        name: true,
        email: true,
        roles: true,
        status: true,
        managerId: true,
        teamId: true,
        timeZone: true,
      },
    });

    const page = rows.slice(0, query.limit);

    res.status(200).json({
      items: page,
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  }),
);

/**
 * US-205 — bulk import, with a dry run that is the same code path.
 *
 * `dryRun` decides whether the plan is committed and nothing else. A preview
 * computed by one function and a commit performed by another is a preview that
 * can be wrong, and the only time anybody finds out is after they trusted it.
 *
 * The response is 200 for both, including when every row failed: the request
 * was understood and answered in full. A 4xx would be the server saying it
 * could not process the file, when what it did was process the file and report
 * on it row by row.
 */
usersRouter.post(
  '/import',
  authenticated(async (req, res) => {
    if (!allows(req.actor, 'BULK_IMPORT_USERS', { orgId: req.actor.orgId, id: null }, [])) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseBody(importUsersRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const [users, teams] = await Promise.all([
      req.db.user.findMany({ select: { id: true, email: true } }),
      req.db.team.findMany({ select: { id: true, name: true } }),
    ]);

    const plan = planImport(parsed.data.rows, { users, teams });

    if (parsed.data.dryRun) {
      res.status(200).json({
        dryRun: true,
        created: plan.creates.length,
        skipped: plan.skipped.length,
        errors: plan.errors,
      });
      return;
    }

    const written = await commitImport(req.db, auditActor(req.actor, requestContext(req)), plan);

    res.status(200).json({ dryRun: false, ...written, errors: plan.errors });
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
