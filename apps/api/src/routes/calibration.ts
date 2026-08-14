/**
 * Calibration endpoints (PRD US-801, US-802, US-803) — W4-17.
 */

import { can, isActionAllowed, type Cycle } from '@aura/core';
import { calibrationAdjustmentRequestSchema, releaseResultsRequestSchema } from '@aura/contracts';
import { Router, type Response } from 'express';

import { authenticated, type AuthedRequest } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { AppraisalStateError, calibrateAppraisal } from '../services/appraisals.js';
import { calibrationView, releaseResults } from '../services/calibration.js';
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

/** Org-wide resources have no subject; the relationship is `SAME_ORG`. */
const orgResource = (orgId: string) => ({ orgId, subjectUserId: null, managerChainIds: [] });

function sendAppraisalError(res: Response, error: AppraisalStateError): void {
  res.status(error.code === 'OFF_SCALE' ? 422 : 409).json({
    error: error.message,
    code: error.code,
    detail: error.detail,
  });
}

async function loadCycle(req: AuthedRequest, cycleId: string): Promise<Cycle | null> {
  return req.db.reviewCycle.findUnique({
    where: { id: cycleId },
    select: { status: true, phases: { select: { key: true, startsAt: true, endsAt: true } } },
  });
}

export const calibrationRouter: Router = Router();

calibrationRouter.use(requireAuth);

/**
 * US-801, US-704 — the distribution, the per-manager split and the outliers.
 *
 * Read-only, and deliberately not gated on the CALIBRATION phase. Looking at a
 * distribution is not a state change, and W2-03's table holds only state
 * changes — putting reads in it would make a closed cycle invisible.
 */
calibrationRouter.get(
  '/',
  authenticated(async (req, res) => {
    const cycleId = queryParam(req.query, 'cycleId');

    if (cycleId === undefined) {
      res.status(400).json({ error: 'A cycleId is required.' });
      return;
    }

    if (!can(req.actor, 'VIEW_CALIBRATION', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    if ((await req.db.reviewCycle.count({ where: { id: cycleId } })) === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const threshold = Number(queryParam(req.query, 'divergenceThreshold'));

    try {
      const view = await calibrationView(
        req.db,
        req.actor.orgId,
        cycleId,
        Number.isFinite(threshold) && threshold > 0 ? { divergenceThreshold: threshold } : {},
      );
      res.status(200).json(view);
    } catch (error) {
      if (error instanceof AppraisalStateError) {
        sendAppraisalError(res, error);
        return;
      }
      throw error;
    }
  }),
);

/** US-802 — adjust a rating, with a mandatory reason and the manager notified. */
calibrationRouter.post(
  '/adjust',
  authenticated(async (req, res) => {
    const parsed = parseBody(calibrationAdjustmentRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    if (!can(req.actor, 'ADJUST_RATING_IN_CALIBRATION', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    /*
     * The appraisal is looked up through its sheet, which IS org-scoped --
     * `Appraisal` carries no `orgId`, so an unqualified lookup here would
     * reach another tenant's row. The service repeats the join for the same
     * reason; this one turns a cross-org id into a 404 rather than a 500.
     */
    const appraisal = await req.db.goalSheet.findFirst({
      where: { appraisal: { id: parsed.data.appraisalId } },
      select: { cycleId: true },
    });

    if (appraisal === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const cycle = await loadCycle(req, appraisal.cycleId);

    if (cycle === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (!isActionAllowed('CALIBRATE', cycle, new Date())) {
      res.status(409).json({ error: 'Calibration is not open for this cycle', code: 'WINDOW_CLOSED' });
      return;
    }

    try {
      const updated = await calibrateAppraisal(
        req.db,
        auditActor(req.actor, requestContext(req)),
        parsed.data.appraisalId,
        { finalRating: parsed.data.finalRating, reason: parsed.data.reason },
      );
      res.status(200).json({ appraisal: updated });
    } catch (error) {
      if (error instanceof AppraisalStateError) {
        sendAppraisalError(res, error);
        return;
      }
      throw error;
    }
  }),
);

/** US-803 — lock calibration and release results org-wide, in one action. */
calibrationRouter.post(
  '/release',
  authenticated(async (req, res) => {
    const parsed = parseBody(releaseResultsRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    if (!can(req.actor, 'RELEASE_RESULTS', orgResource(req.actor.orgId))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const cycle = await loadCycle(req, parsed.data.cycleId);

    if (cycle === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (!isActionAllowed('PUBLISH_RESULTS', cycle, new Date())) {
      res.status(409).json({ error: 'The results window is not open', code: 'WINDOW_CLOSED' });
      return;
    }

    try {
      const result = await releaseResults(
        req.db,
        auditActor(req.actor, requestContext(req)),
        parsed.data.cycleId,
      );
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppraisalStateError) {
        // The named list of unfinished appraisals is the pre-release report
        // the story asks for, so it is worth its own status.
        res.status(error.code === 'NOT_RATED' ? 422 : 409).json({
          error: error.message,
          code: error.code,
          detail: error.detail,
        });
        return;
      }
      throw error;
    }
  }),
);
