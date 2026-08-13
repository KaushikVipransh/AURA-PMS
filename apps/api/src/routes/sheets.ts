/**
 * Goal sheet endpoints (PRD US-301, US-302, US-304, US-601).
 *
 * Timing and permission are checked separately and both must pass: `can()`
 * from W2-06 answers *is this the right person*, `isActionAllowed` from W2-03
 * answers *is it the right time*. Merging them is how the prototype let a
 * manager's authority read as an open window (PLAN.md F-04).
 */

import { can, isActionAllowed, scoreSheet, type Cycle } from '@aura/core';
import { checkInRequestSchema, saveDraftRequestSchema } from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { SheetStateError, recordCheckIn, saveDraft, submitSheet } from '../services/sheets.js';
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

/** Translate a service refusal into a status. */
function sendSheetError(res: Response, error: SheetStateError): void {
  res.status(error.code === 'INVALID_WEIGHTAGES' ? 422 : 409).json({
    error: error.message,
    code: error.code,
    detail: error.detail,
  });
}

/** Load a cycle in the shape `isActionAllowed` expects. */
async function loadCycle(req: AuthedRequest, cycleId: string): Promise<Cycle | null> {
  const cycle = await req.db.reviewCycle.findUnique({
    where: { id: cycleId },
    select: {
      status: true,
      phases: { select: { key: true, startsAt: true, endsAt: true } },
    },
  });

  return cycle;
}

export const sheetsRouter: Router = Router();

sheetsRouter.use(requireAuth);

/** US-304 — my sheet for a cycle, with its computed score. */
sheetsRouter.get(
  '/:cycleId',
  authenticated(async (req, res) => {
    const cycleId = pathParam(req.params, 'cycleId');

    const sheet = await req.db.goalSheet.findFirst({
      where: { cycleId, userId: req.actor.userId },
      select: {
        id: true,
        userId: true,
        cycleId: true,
        status: true,
        submittedAt: true,
        approvedAt: true,
        goals: true,
      },
    });

    if (sheet === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    /*
     * Scored here, on the server, by the single engine from W2-01.
     *
     * The prototype computed this in two JSX components, so the number an
     * employee saw and the number their manager saw could drift with a deploy
     * (F-07). The client is now told the score rather than asked to work it out.
     */
    const score = scoreSheet(
      sheet.goals.map((goal) => ({
        uom: goal.uom,
        direction: goal.direction,
        target: goal.target,
        actualAchievement: goal.actualAchievement,
        status: goal.status,
        weightage: goal.weightage.toString(),
        id: goal.id,
      })),
    );

    res.status(200).json({ sheet, score });
  }),
);

/** US-301 — save a draft. */
sheetsRouter.put(
  '/:cycleId',
  authenticated(async (req, res) => {
    const cycleId = pathParam(req.params, 'cycleId');
    const parsed = parseBody(saveDraftRequestSchema, { ...req.body, cycleId });

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const cycle = await loadCycle(req, cycleId);

    if (cycle === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // Own sheet only. `can()` refuses SELF-scoped edits on anyone else.
    if (
      !can(req.actor, 'EDIT_GOAL_SHEET', {
        orgId: req.actor.orgId,
        subjectUserId: req.actor.userId,
        managerChainIds: [],
      })
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if (!isActionAllowed('EDIT_GOALS', cycle, new Date())) {
      res.status(409).json({ error: 'Goal setting is not open for this cycle', code: 'WINDOW_CLOSED' });
      return;
    }

    try {
      const sheet = await saveDraft(req.db, auditActor(req.actor, requestContext(req)), {
        cycleId,
        goals: parsed.data.goals,
      });
      res.status(200).json({ sheet });
    } catch (error) {
      if (error instanceof SheetStateError) {
        sendSheetError(res, error);
        return;
      }
      throw error;
    }
  }),
);

/** US-302 — submit for approval. */
sheetsRouter.post(
  '/:id/submit',
  authenticated(async (req, res) => {
    const id = pathParam(req.params, 'id');

    const sheet = await req.db.goalSheet.findUnique({
      where: { id },
      select: { id: true, userId: true, cycleId: true },
    });

    if (sheet === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (
      !can(req.actor, 'SUBMIT_GOAL_SHEET', {
        orgId: req.actor.orgId,
        subjectUserId: sheet.userId,
        managerChainIds: [],
      })
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      const submitted = await submitSheet(req.db, auditActor(req.actor, requestContext(req)), id);
      res.status(200).json({ sheet: submitted });
    } catch (error) {
      if (error instanceof SheetStateError) {
        sendSheetError(res, error);
        return;
      }
      throw error;
    }
  }),
);

/**
 * US-601 — record progress.
 *
 * The whitelist that closes F-04 lives in the service, named column by column.
 * The contract schema strips everything else before it ever gets here, so a
 * payload carrying `target` or `weightage` loses them twice over.
 */
sheetsRouter.post(
  '/:id/check-in',
  authenticated(async (req, res) => {
    const id = pathParam(req.params, 'id');
    const parsed = parseBody(checkInRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const sheet = await req.db.goalSheet.findUnique({
      where: { id },
      select: { id: true, userId: true, cycleId: true },
    });

    if (sheet === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (
      !can(req.actor, 'RECORD_CHECK_IN', {
        orgId: req.actor.orgId,
        subjectUserId: sheet.userId,
        managerChainIds: [],
      })
    ) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      const updated = await recordCheckIn(
        req.db,
        auditActor(req.actor, requestContext(req)),
        id,
        parsed.data,
      );
      res.status(200).json({ sheet: updated });
    } catch (error) {
      if (error instanceof SheetStateError) {
        sendSheetError(res, error);
        return;
      }
      throw error;
    }
  }),
);
