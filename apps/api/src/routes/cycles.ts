/**
 * Review cycle endpoints (PRD E2) and the current user (US-102).
 *
 * Grouped because both are small and share the same shape: authenticate, ask
 * `can()`, delegate the write to an audited service.
 */

import { can } from '@aura/core';
import {
  activateCycleRequestSchema,
  createCycleRequestSchema,
  updateCycleRequestSchema,
} from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import {
  CycleConflictError,
  activateCycle,
  closeCycle,
  createCycle,
  updateCycle,
} from '../services/cycles.js';
import { auditActor } from '../services/users.js';
import { parseBody } from '../validate.js';

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

/** Map a service-level conflict onto a status a client can act on. */
function sendConflict(res: Response, error: CycleConflictError): void {
  const status = error.code === 'PHASES_OVERLAP' || error.code === 'NOT_DRAFT' ? 400 : 409;

  res.status(status).json({ error: error.message, code: error.code });
}

export const meRouter: Router = Router();

meRouter.use(requireAuth);

/** US-102 — who am I, according to the server. */
meRouter.get(
  '/',
  authenticated(async (req, res) => {
    const me = await req.db.user.findUniqueOrThrow({
      where: { id: req.actor.userId },
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

    res.status(200).json({ user: me });
  }),
);

export const cyclesRouter: Router = Router();

cyclesRouter.use(requireAuth);

cyclesRouter.get(
  '/',
  authenticated(async (req, res) => {
    // Scoped, so this is every cycle in the caller's organization and no other.
    const cycles = await req.db.reviewCycle.findMany({
      orderBy: [{ fiscalYear: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        fiscalYear: true,
        status: true,
        phases: {
          select: { key: true, label: true, startsAt: true, endsAt: true },
          orderBy: { startsAt: 'asc' },
        },
      },
    });

    res.status(200).json({ cycles });
  }),
);

cyclesRouter.post(
  '/',
  authenticated(async (req, res) => {
    if (!can(req.actor, 'CREATE_CYCLE', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseBody(createCycleRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    try {
      const cycle = await createCycle(req.db, auditActor(req.actor, requestContext(req)), parsed.data);
      res.status(201).json({ cycle });
    } catch (error) {
      if (error instanceof CycleConflictError) {
        sendConflict(res, error);
        return;
      }
      throw error;
    }
  }),
);

cyclesRouter.patch(
  '/:id',
  authenticated(async (req, res) => {
    if (!can(req.actor, 'CONFIGURE_CYCLE', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseBody(updateCycleRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const id = pathParam(req.params, 'id');

    if ((await req.db.reviewCycle.count({ where: { id } })) === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const cycle = await updateCycle(req.db, auditActor(req.actor, requestContext(req)), id, parsed.data);

    res.status(200).json({ cycle });
  }),
);

cyclesRouter.post(
  '/:id/activate',
  authenticated(async (req, res) => {
    if (!can(req.actor, 'CONFIGURE_CYCLE', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const parsed = parseBody(activateCycleRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const id = pathParam(req.params, 'id');

    if ((await req.db.reviewCycle.count({ where: { id } })) === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    try {
      const cycle = await activateCycle(req.db, auditActor(req.actor, requestContext(req)), id);
      res.status(200).json({ cycle });
    } catch (error) {
      if (error instanceof CycleConflictError) {
        sendConflict(res, error);
        return;
      }
      throw error;
    }
  }),
);

cyclesRouter.post(
  '/:id/close',
  authenticated(async (req, res) => {
    if (!can(req.actor, 'CONFIGURE_CYCLE', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const id = pathParam(req.params, 'id');

    if ((await req.db.reviewCycle.count({ where: { id } })) === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const cycle = await closeCycle(req.db, auditActor(req.actor, requestContext(req)), id);

    res.status(200).json({ cycle });
  }),
);
