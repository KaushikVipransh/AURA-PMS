/**
 * Appraisal endpoints (PRD US-701, US-702, US-703, US-704) — W4-15, W4-16.
 *
 * Timing and permission are asked separately and both must pass: `can()` from
 * W2-06 answers *is this the right person*, `isActionAllowed` from W2-03
 * answers *is it the right time*. Merging them is how the prototype let a
 * manager's authority read as an open window (PLAN.md F-04).
 */

import { can, isActionAllowed, type Cycle, type PolicyAction } from '@aura/core';
import {
  acknowledgeRatingRequestSchema,
  managerRatingRequestSchema,
  selfAppraisalRequestSchema,
} from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import {
  AppraisalStateError,
  acknowledgeAppraisal,
  readAppraisal,
  writeManagerRating,
  writeSelfAppraisal,
} from '../services/appraisals.js';
import { reportingChain } from '../services/orgchart.js';
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

/**
 * Map a refusal onto a status.
 *
 * `OFF_SCALE`, `UNKNOWN_GOAL` and `MISSING_GOAL` are 422 — the request is
 * well-formed but does not describe a thing that can exist. The rest are 409:
 * the request is fine, the appraisal is simply not at that stage yet.
 */
function sendAppraisalError(res: Response, error: AppraisalStateError): void {
  const unprocessable =
    error.code === 'OFF_SCALE' || error.code === 'UNKNOWN_GOAL' || error.code === 'MISSING_GOAL';

  res.status(unprocessable ? 422 : 409).json({
    error: error.message,
    code: error.code,
    detail: error.detail,
  });
}

/** A sheet, its owner and their reporting line — everything `can()` needs. */
async function loadSubject(req: AuthedRequest, sheetId: string) {
  const sheet = await req.db.goalSheet.findUnique({
    where: { id: sheetId },
    select: { id: true, userId: true, cycleId: true },
  });

  if (sheet === null) {
    return null;
  }

  return {
    sheet,
    managerChainIds: await reportingChain(req.db, req.actor.orgId, sheet.userId),
  };
}

function allows(
  req: AuthedRequest,
  action: PolicyAction,
  subject: { sheet: { userId: string }; managerChainIds: string[] },
): boolean {
  return can(req.actor, action, {
    orgId: req.actor.orgId,
    subjectUserId: subject.sheet.userId,
    managerChainIds: subject.managerChainIds,
  });
}

async function loadCycle(req: AuthedRequest, cycleId: string): Promise<Cycle | null> {
  return req.db.reviewCycle.findUnique({
    where: { id: cycleId },
    select: { status: true, phases: { select: { key: true, startsAt: true, endsAt: true } } },
  });
}

export const appraisalsRouter: Router = Router();

appraisalsRouter.use(requireAuth);

/**
 * US-701, US-702 — the appraisal, pre-populated.
 *
 * The same document for both readers. An employee writing their reflection and
 * a manager rating them are looking at one set of goals with one set of
 * computed scores, and giving them two endpoints would be two chances for the
 * numbers to differ — which is F-07 rebuilt at the API layer.
 */
appraisalsRouter.get(
  '/:sheetId',
  authenticated(async (req, res) => {
    const found = await loadSubject(req, pathParam(req.params, 'sheetId'));

    if (found === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (!allows(req, 'VIEW_GOAL_SHEET', found)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    try {
      res.status(200).json(await readAppraisal(req.db, found.sheet.id));
    } catch (error) {
      if (error instanceof AppraisalStateError) {
        sendAppraisalError(res, error);
        return;
      }
      throw error;
    }
  }),
);

/** US-701 — save the self-appraisal without submitting it. */
appraisalsRouter.put(
  '/:sheetId/self',
  authenticated(async (req, res) => {
    await handleSelf(req, res, false);
  }),
);

/** US-701 — submit it, which locks it from further editing. */
appraisalsRouter.post(
  '/:sheetId/self/submit',
  authenticated(async (req, res) => {
    await handleSelf(req, res, true);
  }),
);

async function handleSelf(req: AuthedRequest, res: Response, submit: boolean): Promise<void> {
  const found = await loadSubject(req, pathParam(req.params, 'sheetId'));

  if (found === null) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const parsed = parseBody(selfAppraisalRequestSchema, req.body);

  if (!parsed.ok) {
    res.status(400).json(parsed.error);
    return;
  }

  // `WRITE_SELF_APPRAISAL` is SELF-only for every role, so this is the check
  // that stops a manager writing their report's reflection for them.
  if (!allows(req, 'WRITE_SELF_APPRAISAL', found)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const cycle = await loadCycle(req, found.sheet.cycleId);

  if (cycle === null) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (!isActionAllowed('SUBMIT_SELF_APPRAISAL', cycle, new Date())) {
    res.status(409).json({ error: 'The appraisal window is not open', code: 'WINDOW_CLOSED' });
    return;
  }

  try {
    const appraisal = await writeSelfAppraisal(
      req.db,
      auditActor(req.actor, requestContext(req)),
      found.sheet.id,
      parsed.data,
      submit,
    );
    res.status(200).json({ appraisal });
  } catch (error) {
    if (error instanceof AppraisalStateError) {
      sendAppraisalError(res, error);
      return;
    }
    throw error;
  }
}

/**
 * US-702 — the manager's rating.
 *
 * `RATE_REPORT` is DIRECT_REPORT only in W2-06: a skip-level manager
 * influences the outcome through calibration, not by overwriting the rating of
 * someone they do not work with.
 */
appraisalsRouter.post(
  '/:sheetId/rating',
  authenticated(async (req, res) => {
    const found = await loadSubject(req, pathParam(req.params, 'sheetId'));

    if (found === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const parsed = parseBody(managerRatingRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    if (!allows(req, 'RATE_REPORT', found)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const cycle = await loadCycle(req, found.sheet.cycleId);

    if (cycle === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (!isActionAllowed('SUBMIT_MANAGER_APPRAISAL', cycle, new Date())) {
      res.status(409).json({ error: 'The appraisal window is not open', code: 'WINDOW_CLOSED' });
      return;
    }

    try {
      const appraisal = await writeManagerRating(
        req.db,
        auditActor(req.actor, requestContext(req)),
        found.sheet.id,
        parsed.data,
      );
      res.status(200).json({ appraisal });
    } catch (error) {
      if (error instanceof AppraisalStateError) {
        sendAppraisalError(res, error);
        return;
      }
      throw error;
    }
  }),
);

/**
 * US-703 — acknowledge, optionally disagreeing on the record.
 *
 * Not gated on the cycle phase. Results are released in the RESULTS window, but
 * an employee reading and acknowledging their rating three weeks later is not
 * doing anything the cycle needs to govern — and refusing them would leave the
 * appraisal permanently unacknowledged.
 */
appraisalsRouter.post(
  '/:sheetId/acknowledge',
  authenticated(async (req, res) => {
    const found = await loadSubject(req, pathParam(req.params, 'sheetId'));

    if (found === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const parsed = parseBody(acknowledgeRatingRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    if (!allows(req, 'ACKNOWLEDGE_RATING', found)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      const appraisal = await acknowledgeAppraisal(
        req.db,
        auditActor(req.actor, requestContext(req)),
        found.sheet.id,
        {
          comment: parsed.data.comment,
          // A dispute is a comment plus a flag, so the flag rides on the query
          // string rather than adding a second endpoint for the same act.
          dispute: req.query['dispute'] === 'true',
        },
      );
      res.status(200).json({ appraisal });
    } catch (error) {
      if (error instanceof AppraisalStateError) {
        sendAppraisalError(res, error);
        return;
      }
      throw error;
    }
  }),
);
