/**
 * Analytics, compliance, escalations and the audit trail — W4-18, W4-19, W4-20.
 *
 * Grouped because all four are the same shape: an administrator asks the
 * database a question about a whole cycle, and the answer is counted in SQL.
 * The one mutation among them, resolving an escalation, is audited like every
 * other.
 */

import { can, daysOverdue } from '@aura/core';
import {
  analyticsQuerySchema,
  listAuditQuerySchema,
  listEscalationsQuerySchema,
  resolveEscalationRequestSchema,
} from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { complianceSummary, cycleAnalytics } from '../services/analytics.js';
import { EscalationStateError, resolveEscalation } from '../services/escalations.js';
import { auditActor } from '../services/users.js';
import { parseBody, parseQuery } from '../validate.js';

function pathParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];

  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function requestContext(req: AuthedRequest): { ip: string | undefined; userAgent: string | undefined } {
  const userAgent = req.headers['user-agent'];

  return { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent : undefined };
}

/** Org-wide resources have no subject; the relationship is `SAME_ORG`. */
const orgResource = (orgId: string) => ({ orgId, subjectUserId: null, managerChainIds: [] });

export const analyticsRouter: Router = Router();

analyticsRouter.use(requireAuth);

/**
 * US-1001 — distribution analytics, counted by Postgres (W4-18, closes F-13).
 */
analyticsRouter.get(
  '/',
  authenticated(async (req, res) => {
    if (!can(req.actor, 'VIEW_ANALYTICS', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseQuery(analyticsQuerySchema, req.query);

    if (!parsed.ok) {
      res.status(400).json({ error: 'A valid cycleId is required.' });
      return;
    }

    const { cycleId, teamId, managerId } = parsed.data;

    if ((await req.db.reviewCycle.count({ where: { id: cycleId } })) === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res
      .status(200)
      .json(await cycleAnalytics(req.db, req.actor.orgId, cycleId, { teamId, managerId }));
  }),
);

export const complianceRouter: Router = Router();

complianceRouter.use(requireAuth);

/** US-903 — the live compliance dashboard for a cycle. */
complianceRouter.get(
  '/',
  authenticated(async (req, res) => {
    if (!can(req.actor, 'VIEW_COMPLIANCE_DASHBOARD', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const cycleId = queryString(req.query, 'cycleId');

    if (cycleId === undefined) {
      res.status(400).json({ error: 'A cycleId is required.' });
      return;
    }

    if ((await req.db.reviewCycle.count({ where: { id: cycleId } })) === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.status(200).json(await complianceSummary(req.db, req.actor.orgId, cycleId));
  }),
);

function queryString(query: unknown, key: string): string | undefined {
  const value = (query as Record<string, unknown>)[key];

  return typeof value === 'string' && value !== '' ? value : undefined;
}

export const escalationsRouter: Router = Router();

escalationsRouter.use(requireAuth);

/**
 * US-903 — the escalation list, with real overdue days.
 *
 * `daysOverdue` comes from W2-04 and is computed per row against the subject's
 * own timezone. The prototype floored this at four days with
 * `Math.max(elapsed, 4)`, so a sheet saved seconds earlier reported "4 days
 * overdue" (PLAN.md F-08). There is no floor here, and a test pins that down.
 */
escalationsRouter.get(
  '/',
  authenticated(async (req, res) => {
    if (!can(req.actor, 'VIEW_COMPLIANCE_DASHBOARD', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseQuery(listEscalationsQuerySchema, req.query);

    if (!parsed.ok) {
      res.status(400).json({ error: 'A valid cycleId is required.' });
      return;
    }

    const query = parsed.data;
    const now = new Date();

    const rows = await req.db.escalation.findMany({
      where: {
        cycleId: query.cycleId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.tier === undefined ? {} : { tier: query.tier }),
        ...(query.rule === undefined ? {} : { rule: query.rule }),
        ...(query.subjectUserId === undefined ? {} : { subjectUserId: query.subjectUserId }),
      },
      // One past the page, so "is there more" is answered without a second
      // count over the same predicate.
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        cycleId: true,
        subjectUserId: true,
        rule: true,
        tier: true,
        status: true,
        dueAt: true,
        notifiedAt: true,
        resolvedAt: true,
        resolutionNote: true,
        subject: { select: { name: true, timeZone: true } },
      },
    });

    const page = rows.slice(0, query.limit);

    res.status(200).json({
      items: page.map(({ subject, ...escalation }) => ({
        ...escalation,
        subjectName: subject.name,
        /* Real elapsed days in the subject's own zone. Someone in Auckland and
           someone in Los Angeles do not cross midnight together. */
        daysOverdue: daysOverdue(escalation.dueAt, now, subject.timeZone),
      })),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  }),
);

/** US-904 — resolve with a note, which is required. */
escalationsRouter.post(
  '/:id/resolve',
  authenticated(async (req, res) => {
    const id = pathParam(req.params, 'id');

    if (!can(req.actor, 'RESOLVE_ESCALATION', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseBody(resolveEscalationRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    if ((await req.db.escalation.count({ where: { id } })) === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    try {
      const escalation = await resolveEscalation(
        req.db,
        auditActor(req.actor, requestContext(req)),
        id,
        parsed.data.note,
      );
      res.status(200).json({ escalation });
    } catch (error) {
      if (error instanceof EscalationStateError) {
        sendEscalationError(res, error);
        return;
      }
      throw error;
    }
  }),
);

function sendEscalationError(res: Response, error: EscalationStateError): void {
  res.status(409).json({ error: error.message, code: error.code });
}

export const auditRouter: Router = Router();

auditRouter.use(requireAuth);

/**
 * US-1102 — search the audit trail (W4-19).
 *
 * Org admin and HR only, which `VIEW_AUDIT_TRAIL` already says. There is no
 * write path here and there never will be: the trail is append-only, and an
 * endpoint that could edit it would make every row in it worth less.
 */
auditRouter.get(
  '/',
  authenticated(async (req, res) => {
    if (!can(req.actor, 'VIEW_AUDIT_TRAIL', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseQuery(listAuditQuerySchema, req.query);

    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid audit query.' });
      return;
    }

    const query = parsed.data;
    const createdAt = {
      ...(query.from === undefined ? {} : { gte: query.from }),
      ...(query.to === undefined ? {} : { lte: query.to }),
    };

    const rows = await req.db.auditEvent.findMany({
      where: {
        ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
        ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
        ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
        // `startsWith`, so `goalsheet.` finds every verb on a goal sheet. An
        // exact match would make the filter useless for the question people
        // actually ask, which is "what happened to sheets".
        ...(query.action === undefined ? {} : { action: { startsWith: query.action } }),
        ...(Object.keys(createdAt).length === 0 ? {} : { createdAt }),
      },
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        orgId: true,
        actorId: true,
        action: true,
        entityType: true,
        entityId: true,
        before: true,
        after: true,
        ip: true,
        userAgent: true,
        createdAt: true,
      },
    });

    const page = rows.slice(0, query.limit);

    res.status(200).json({
      items: page.map((event) => ({
        ...event,
        // Derived from the diff rather than stored, so it cannot disagree with
        // the payload it describes.
        changedFields: Object.keys({
          ...(event.before as Record<string, unknown> | null),
          ...(event.after as Record<string, unknown> | null),
        }),
      })),
      nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    });
  }),
);
