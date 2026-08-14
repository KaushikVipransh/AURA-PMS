/**
 * Shared goals (PRD US-401, US-402, US-403) — W4-13.
 *
 * Two verbs on the same body: `preview` says what would happen, `create` makes
 * it happen. They call the same planner with the same inputs, so the preview is
 * a promise the commit keeps.
 *
 * The authorisation check is not here. `CASCADE_SHARED_GOAL` grants a manager
 * DIRECT_REPORT and INDIRECT_REPORT, which is a question about each recipient
 * rather than about the caller — so it is asked per person inside the service,
 * against each one's real reporting chain, and a caller who reaches nobody is
 * refused there. A coarse role check at the router would have to guess at that
 * answer, and would be a second opinion on it.
 */

import { isActionAllowed, type Cycle } from '@aura/core';
import { createSharedGoalRequestSchema } from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { CascadeRefusedError, createSharedGoal, previewCascade } from '../services/sharedGoals.js';
import { auditActor } from '../services/users.js';
import { parseBody } from '../validate.js';

function requestContext(req: AuthedRequest): { ip: string | undefined; userAgent: string | undefined } {
  const userAgent = req.headers['user-agent'];

  return { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent : undefined };
}

function queryParam(query: unknown, key: string): string | undefined {
  const value = (query as Record<string, unknown>)[key];

  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Map a refusal onto a status.
 *
 * The two reach failures are 403 — the caller is asking about people they are
 * not permitted to act on. Everything else is about the request's contents and
 * answers 422, which is the difference between "you may not" and "that will
 * not work".
 */
function sendRefusal(res: Response, error: CascadeRefusedError): void {
  const forbidden = error.code === 'NO_REACH' || error.code === 'OWNER_OUT_OF_REACH';

  res.status(forbidden ? 403 : 422).json({
    error: error.message,
    code: error.code,
    detail: error.detail,
  });
}

export const sharedGoalsRouter: Router = Router();

sharedGoalsRouter.use(requireAuth);

/** Every shared goal in a cycle, with how many sheets carry an instance. */
sharedGoalsRouter.get(
  '/',
  authenticated(async (req, res) => {
    const cycleId = queryParam(req.query, 'cycleId');

    if (cycleId === undefined) {
      res.status(400).json({ error: 'A cycleId is required.' });
      return;
    }

    const sharedGoals = await req.db.sharedGoal.findMany({
      where: { cycleId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orgId: true,
        cycleId: true,
        ownerUserId: true,
        createdById: true,
        title: true,
        thrustArea: true,
        uom: true,
        direction: true,
        target: true,
        defaultWeightage: true,
        _count: { select: { instances: true } },
      },
    });

    res.status(200).json({
      sharedGoals: sharedGoals.map(({ _count, defaultWeightage, ...goal }) => ({
        ...goal,
        defaultWeightage: Number(defaultWeightage.toString()),
        instanceCount: _count.instances,
      })),
    });
  }),
);

/**
 * US-402 — the preview.
 *
 * Writes nothing. The prototype had no equivalent: its cascade found out who
 * could not take the goal by failing partway through, which left some people
 * holding an invalid sheet and no record of which (F-05).
 */
sharedGoalsRouter.post(
  '/preview',
  authenticated(async (req, res) => {
    const parsed = parseBody(createSharedGoalRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    try {
      const cascade = await previewCascade(req.db, req.actor, parsed.data);
      res.status(200).json({ cascade });
    } catch (error) {
      if (error instanceof CascadeRefusedError) {
        sendRefusal(res, error);
        return;
      }
      throw error;
    }
  }),
);

/**
 * US-401, US-403 — commit the cascade.
 *
 * Timing is checked as well as permission, and separately: `can()` answers *is
 * this the right person*, `isActionAllowed` answers *is it the right time*.
 * Merging the two is how the prototype let a manager's authority read as an
 * open window (F-04).
 */
sharedGoalsRouter.post(
  '/',
  authenticated(async (req, res) => {
    const parsed = parseBody(createSharedGoalRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const cycle = await loadCycle(req, parsed.data.cycleId);

    if (cycle === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    /*
     * `EDIT_GOALS`, not a cascade-specific action.
     *
     * A cascade puts goals on sheets, which is the same act the goal-setting
     * window governs — and W2-03's table has no separate entry for it because
     * there is no separate window. Inventing one here would be a second
     * opinion on when goals may change, which is the disagreement F-03 was.
     */
    if (!isActionAllowed('EDIT_GOALS', cycle, new Date())) {
      res
        .status(409)
        .json({ error: 'Goal setting is not open for this cycle', code: 'WINDOW_CLOSED' });
      return;
    }

    try {
      const result = await createSharedGoal(
        req.db,
        req.actor,
        auditActor(req.actor, requestContext(req)),
        parsed.data,
      );
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof CascadeRefusedError) {
        sendRefusal(res, error);
        return;
      }
      throw error;
    }
  }),
);

/** Load a cycle in the shape `isActionAllowed` expects. */
async function loadCycle(req: AuthedRequest, cycleId: string): Promise<Cycle | null> {
  return req.db.reviewCycle.findUnique({
    where: { id: cycleId },
    select: { status: true, phases: { select: { key: true, startsAt: true, endsAt: true } } },
  });
}
