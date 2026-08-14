/**
 * Teams and the org chart (PRD US-105, US-1003) — W4-04.
 *
 * Two routers, because they answer different questions about the same data.
 * `/teams` is about the units an organization is divided into; `/org-chart` is
 * about who reports to whom, which is a tree and is walked as one.
 */

import { can } from '@aura/core';
import { createTeamRequestSchema } from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { reportingChain, reportingSubtree } from '../services/orgchart.js';
import { TeamConflictError, createTeam } from '../services/teams.js';
import { auditActor } from '../services/users.js';
import { parseBody } from '../validate.js';

function pathParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];

  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function queryParam(query: unknown, key: string): string | undefined {
  const value = (query as Record<string, unknown>)[key];

  return typeof value === 'string' && value !== '' ? value : undefined;
}

function requestContext(req: AuthedRequest): { ip: string | undefined; userAgent: string | undefined } {
  const userAgent = req.headers['user-agent'];

  return { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent : undefined };
}

const notFound = (res: Response): void => {
  res.status(404).json({ error: 'Not found' });
};

/** The columns an org-chart node carries. Enough to draw it, and no more. */
const NODE_VIEW = {
  id: true,
  name: true,
  email: true,
  managerId: true,
  teamId: true,
  status: true,
} as const;

/**
 * Turn a list of ids from a recursive walk into rows, in the walk's order.
 *
 * Fetched through `req.db`, so the tenancy filter is applied by the query
 * pipeline. The raw walk states `orgId` by hand because it has to; everything
 * a client actually reads still goes through the extension that cannot forget.
 */
async function hydrate(
  req: AuthedRequest,
  entries: readonly { userId: string; depth: number }[],
) {
  const rows = await req.db.user.findMany({
    where: { id: { in: entries.map((entry) => entry.userId) } },
    select: NODE_VIEW,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  return entries.flatMap((entry) => {
    const row = byId.get(entry.userId);

    return row === undefined ? [] : [{ ...row, depth: entry.depth }];
  });
}

export const teamsRouter: Router = Router();

teamsRouter.use(requireAuth);

/**
 * Every team in the caller's organization.
 *
 * No `can()` call, deliberately, and for the same reason `GET /cycles` has
 * none: there is no per-subject question to ask. The scoped client has already
 * limited this to the caller's own organization, and which teams exist is not
 * a secret from the people in them.
 */
teamsRouter.get(
  '/',
  authenticated(async (req, res) => {
    const teams = await req.db.team.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        orgId: true,
        name: true,
        leadId: true,
        parentTeamId: true,
        _count: { select: { members: true } },
      },
    });

    res.status(200).json({
      teams: teams.map(({ _count, ...team }) => ({ ...team, memberCount: _count.members })),
    });
  }),
);

/** US-1003 — create a team. Administrators only; see `MANAGE_TEAM` in W2-06. */
teamsRouter.post(
  '/',
  authenticated(async (req, res) => {
    if (
      !can(req.actor, 'MANAGE_TEAM', {
        orgId: req.actor.orgId,
        subjectUserId: null,
        managerChainIds: [],
      })
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseBody(createTeamRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    try {
      const team = await createTeam(req.db, auditActor(req.actor, requestContext(req)), parsed.data);
      res.status(201).json({ team });
    } catch (error) {
      if (error instanceof TeamConflictError) {
        res
          .status(error.code === 'DUPLICATE_NAME' ? 409 : 400)
          .json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
  }),
);

/** One team and its members. */
teamsRouter.get(
  '/:id',
  authenticated(async (req, res) => {
    const id = pathParam(req.params, 'id');
    const team = await req.db.team.findUnique({
      where: { id },
      select: { id: true, orgId: true, name: true, leadId: true, parentTeamId: true },
    });

    if (team === null) {
      notFound(res);
      return;
    }

    const members = await req.db.user.findMany({
      where: { teamId: id },
      orderBy: { name: 'asc' },
      select: NODE_VIEW,
    });

    res.status(200).json({ team: { ...team, memberCount: members.length }, members });
  }),
);

export const orgChartRouter: Router = Router();

orgChartRouter.use(requireAuth);

/**
 * US-1003 — someone and everyone beneath them, as a flat list with depths.
 *
 * Defaults to the caller, so "my org chart" needs no parameters. Asking for
 * someone else's is a per-subject question, and `can()` answers it: a manager
 * may look down their own line, an administrator anywhere in the organization,
 * an employee only at themselves.
 */
orgChartRouter.get(
  '/',
  authenticated(async (req, res) => {
    const rootId = queryParam(req.query, 'rootId') ?? req.actor.userId;

    const root = await req.db.user.findUnique({
      where: { id: rootId },
      select: { id: true, managerId: true },
    });

    if (root === null) {
      notFound(res);
      return;
    }

    const chain = await reportingChain(req.db, req.actor.orgId, rootId);

    if (
      !can(req.actor, 'VIEW_USER', {
        orgId: req.actor.orgId,
        subjectUserId: rootId,
        managerChainIds: chain,
      })
    ) {
      // 404, not 403: a 403 would confirm the id exists.
      notFound(res);
      return;
    }

    const nodes = await hydrate(req, await reportingSubtree(req.db, req.actor.orgId, rootId));

    res.status(200).json({ rootId, nodes });
  }),
);

/** US-105 — the reporting line above someone, nearest manager first. */
orgChartRouter.get(
  '/:userId/chain',
  authenticated(async (req, res) => {
    const userId = pathParam(req.params, 'userId');

    const subject = await req.db.user.findUnique({ where: { id: userId }, select: { id: true } });

    if (subject === null) {
      notFound(res);
      return;
    }

    const chainIds = await reportingChain(req.db, req.actor.orgId, userId);

    if (
      !can(req.actor, 'VIEW_USER', {
        orgId: req.actor.orgId,
        subjectUserId: userId,
        managerChainIds: chainIds,
      })
    ) {
      notFound(res);
      return;
    }

    const chain = await hydrate(
      req,
      chainIds.map((id, index) => ({ userId: id, depth: index + 1 })),
    );

    res.status(200).json({ userId, chain });
  }),
);
