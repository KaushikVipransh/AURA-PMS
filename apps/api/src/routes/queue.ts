/**
 * The manager's queue (PRD US-501) — W6-09's data source.
 *
 * Mounted at `/queue` rather than added to `/sheets`, and that is a routing
 * decision rather than a taste one: `GET /sheets/:cycleId` already owns every
 * single-segment path under `/sheets`, so `GET /sheets/queue` would be read as
 * a cycle called "queue" and answered with a 404 by the handler above it.
 *
 * There is no `POST /queue/bulk-approve` here, deliberately. Approving several
 * sheets at once is several approvals: each one snapshots its own sheet, writes
 * its own audit row and notifies its own employee, and each can fail on its own
 * terms — one sheet has been withdrawn, another was approved by a colleague a
 * minute ago. A single endpoint would have to invent a status code for "four of
 * six", and the honest answers it could give are exactly the six the client
 * already gets by asking six times.
 */

import { listSheetsQuerySchema } from '@aura/contracts';
import { Router } from 'express';

import { authenticated } from '../auth/authenticated.js';
import { requireAuth } from '../auth/index.js';
import { managerQueue } from '../services/queue.js';
import { parseQuery } from '../validate.js';

export const queueRouter: Router = Router();

queueRouter.use(requireAuth);

/**
 * US-501 — everything in my reporting line for a cycle, most urgent first.
 *
 * No `can()` call guards the endpoint itself, because there is no single
 * subject to ask about: the answer is per row and the service asks per row.
 * An employee with nobody reporting to them gets an empty list rather than a
 * 403 — which is the truthful answer, and one that does not require the client
 * to know its own role to decide whether to render the page.
 */
queueRouter.get(
  '/',
  authenticated(async (req, res) => {
    const parsed = parseQuery(listSheetsQuerySchema, req.query);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const cycle = await req.db.reviewCycle.findUnique({
      where: { id: parsed.data.cycleId },
      select: {
        id: true,
        status: true,
        phases: { select: { key: true, startsAt: true, endsAt: true } },
      },
    });

    if (cycle === null) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const { items, counts } = await managerQueue(
      req.db,
      req.actor,
      cycle,
      parsed.data,
      new Date(),
    );

    res.status(200).json({ cycleId: cycle.id, items, counts });
  }),
);
