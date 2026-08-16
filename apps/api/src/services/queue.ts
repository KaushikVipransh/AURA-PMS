/**
 * The manager's queue (PRD US-501) — one list of everything awaiting an action.
 *
 * **The queue is derived from the policy, not from a second rule beside it.**
 * US-501's acceptance criterion says "shows only direct reports", and it would
 * be easy to satisfy that with `where: { managerId: actor.userId }`. That is
 * the mistake: the list would then be a *guess* at what W2-06 will permit, and
 * the two would disagree the first time a scope changed — either showing rows
 * whose buttons 403, or hiding work somebody was supposed to do. So the walk
 * gathers the whole reporting subtree and `can()` decides, row by row, using
 * the same chain the endpoint will rebuild when the action arrives.
 *
 * That is why approval reaches indirect reports and rating does not: W2-06
 * grants `APPROVE_GOAL_SHEET` on REPORTS and `RATE_REPORT` on DIRECT_REPORT
 * only. Neither fact is restated here.
 *
 * Nothing in this file reads a clock — `now` is a parameter, so "what does the
 * queue say the morning the window closes" is a test rather than a hope.
 */

import {
  can,
  daysOverdue,
  deadlineFor,
  scoreSheet,
  type Actor,
  type Cycle,
} from '@aura/core';
import type { ListSheetsQuery } from '@aura/contracts';

import type { ScopedPrisma } from '../db/scoped.js';
import { chainWithin, reportingSubtree } from './orgchart.js';

/** What the caller can do about a row, right now. */
export type QueueAction = 'APPROVE' | 'RETURN' | 'RATE';

export type QueueItem = {
  readonly sheetId: string;
  readonly userId: string;
  readonly userName: string;
  readonly status: 'DRAFT' | 'PENDING' | 'RETURNED' | 'APPROVED';
  readonly submittedAt: Date | null;
  readonly goalCount: number;
  /** The W2-01 score, computed on the server like everywhere else (F-07). */
  readonly score: number;
  readonly selfAppraisalSubmitted: boolean;
  readonly rated: boolean;
  readonly actions: readonly QueueAction[];
  /** The phase deadline the row is measured against, if it has one. */
  readonly dueAt: Date | null;
  /** Whole calendar days late in the *subject's* zone, never floored (F-08). */
  readonly daysOverdue: number;
};

export type QueueCounts = {
  readonly total: number;
  readonly awaitingApproval: number;
  readonly awaitingRating: number;
  readonly overdue: number;
};

const SHEET_ROWS = {
  id: true,
  userId: true,
  status: true,
  submittedAt: true,
  user: { select: { name: true, timeZone: true } },
  appraisal: { select: { selfSubmittedAt: true, managerSubmittedAt: true } },
  goals: {
    select: {
      id: true,
      uom: true,
      direction: true,
      target: true,
      actualAchievement: true,
      status: true,
      weightage: true,
    },
  },
} as const;

/**
 * Everything in the caller's line for one cycle, with what they may do to it.
 *
 * The sheets are fetched through the scoped client, so tenancy is enforced by
 * the query pipeline; only the recursive walk states `orgId` by hand, and it
 * has to (see `orgchart.ts`).
 */
export async function managerQueue(
  db: ScopedPrisma,
  actor: Actor,
  cycle: Cycle & { readonly id: string },
  query: ListSheetsQuery,
  now: Date,
): Promise<{ items: QueueItem[]; counts: QueueCounts }> {
  const entries = await reportingSubtree(db, actor.orgId, actor.userId);
  /* The caller's own sheet is not queue work. They cannot approve it — W2-06
     refuses SELF on APPROVE_GOAL_SHEET — and it already has a page of its own. */
  const reports = entries.filter((entry) => entry.userId !== actor.userId);

  const reportIds = reports.map((entry) => entry.userId);

  /*
   * `userId` narrows the walk; it never replaces it.
   *
   * Passing the id straight into the `where` would let a manager name anybody
   * in the organization and get their name, goal count and score back. The
   * per-row `can()` below would leave the buttons off, so it would not be an
   * *action* leak — but the row itself is the leak, and a filter is not an
   * authorization.
   */
  const subjectIds =
    query.userId === undefined ? reportIds : reportIds.filter((id) => id === query.userId);

  if (subjectIds.length === 0) {
    return { items: [], counts: emptyCounts() };
  }

  const sheets = await db.goalSheet.findMany({
    where: {
      cycleId: cycle.id,
      userId: { in: subjectIds },
      ...(query.status === undefined ? {} : { status: query.status }),
    },
    select: SHEET_ROWS,
  });

  const approvalDue = deadlineFor('APPROVE_GOAL_SHEET', cycle);
  const ratingDue = deadlineFor('SUBMIT_MANAGER_APPRAISAL', cycle);

  const items = sheets.map((sheet): QueueItem => {
    const managerChainIds = chainWithin(entries, sheet.userId, actor.userId);
    const resource = { orgId: actor.orgId, subjectUserId: sheet.userId, managerChainIds };

    const selfAppraisalSubmitted = sheet.appraisal?.selfSubmittedAt != null;
    const rated = sheet.appraisal?.managerSubmittedAt != null;

    const actions: QueueAction[] = [];

    if (sheet.status === 'PENDING') {
      if (can(actor, 'APPROVE_GOAL_SHEET', resource)) {
        actions.push('APPROVE');
      }
      if (can(actor, 'RETURN_GOAL_SHEET', resource)) {
        actions.push('RETURN');
      }
    }

    if (selfAppraisalSubmitted && !rated && can(actor, 'RATE_REPORT', resource)) {
      actions.push('RATE');
    }

    /* One deadline per row, chosen by what is actually outstanding. A sheet
       waiting to be rated is not late because goal setting closed in March. */
    const dueAt = actions.includes('RATE')
      ? ratingDue
      : sheet.status === 'PENDING'
        ? approvalDue
        : null;

    return {
      sheetId: sheet.id,
      userId: sheet.userId,
      userName: sheet.user.name,
      status: sheet.status,
      submittedAt: sheet.submittedAt,
      goalCount: sheet.goals.length,
      score: scoreSheet(
        sheet.goals.map((goal) => ({
          id: goal.id,
          uom: goal.uom,
          direction: goal.direction,
          target: goal.target,
          actualAchievement: goal.actualAchievement,
          status: goal.status,
          weightage: goal.weightage.toString(),
        })),
      ).score,
      selfAppraisalSubmitted,
      rated,
      actions,
      dueAt,
      daysOverdue: dueAt === null ? 0 : daysOverdue(dueAt, now, sheet.user.timeZone),
    };
  });

  const visible = items
    .filter((item) => !query.awaitingMyAction || item.actions.length > 0)
    .filter(
      (item) =>
        query.dueBefore === undefined ||
        (item.dueAt !== null && item.dueAt.getTime() <= query.dueBefore.getTime()),
    )
    .sort(byUrgency);

  return { items: visible, counts: countsOf(visible) };
}

/**
 * Most urgent first: the latest rows, then the soonest deadlines, then names.
 *
 * A row with no deadline sorts last rather than first. `null` is "nothing is
 * waiting on this", and treating it as an infinitely near deadline — which is
 * what a naive `?? 0` does — would put finished work at the top of a queue.
 */
function byUrgency(a: QueueItem, b: QueueItem): number {
  if (a.daysOverdue !== b.daysOverdue) {
    return b.daysOverdue - a.daysOverdue;
  }

  const left = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const right = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;

  return left === right ? a.userName.localeCompare(b.userName) : left - right;
}

const emptyCounts = (): QueueCounts => ({
  total: 0,
  awaitingApproval: 0,
  awaitingRating: 0,
  overdue: 0,
});

/**
 * The badge numbers (US-501).
 *
 * Counted over the rows the caller can act on, not over everything returned,
 * so a badge of 3 means three things to do rather than three things to look at.
 */
function countsOf(items: readonly QueueItem[]): QueueCounts {
  return {
    total: items.length,
    awaitingApproval: items.filter((item) => item.actions.includes('APPROVE')).length,
    awaitingRating: items.filter((item) => item.actions.includes('RATE')).length,
    overdue: items.filter((item) => item.actions.length > 0 && item.daysOverdue > 0).length,
  };
}

/* ------------------------------------------------------------------ *
 * The review view (US-503, US-702)
 * ------------------------------------------------------------------ */

export type CheckInChange = {
  readonly goalId: string;
  readonly title: string;
  readonly fromActual: string | null;
  readonly toActual: string | null;
  readonly fromStatus: string;
  readonly toStatus: string;
};

export type CheckInEvent = {
  readonly at: Date;
  readonly actorId: string;
  readonly changes: readonly CheckInChange[];
};

type AuditGoal = {
  id?: unknown;
  title?: unknown;
  actualAchievement?: unknown;
  status?: unknown;
};

const goalsOf = (side: unknown): AuditGoal[] => {
  const goals = (side as { goals?: unknown } | null)?.goals;

  return Array.isArray(goals) ? (goals as AuditGoal[]) : [];
};

/**
 * A stored achievement as a value, treating blank as absent.
 *
 * `null` and `''` are the same statement — nothing reported — and the
 * difference between them is which form the browser last posted. Comparing
 * them literally makes "cleared a field that was already empty" a history
 * entry, which reads as `— → —` and is not something anybody did.
 */
const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * The check-in history of a sheet, reconstructed from the audit trail.
 *
 * **No second table.** US-702 wants the check-in history visible while rating,
 * and every check-in already writes an append-only audit row carrying the whole
 * sheet before and after (W4-11). A parallel history table would be a copy of
 * that, kept in step by hand, and the copy is what goes wrong: the trail is
 * written inside the same transaction as the change, a history table added
 * later would not be.
 *
 * Only the two fields a check-in may touch are diffed, because they are the
 * only two it can have changed (F-04).
 */
export async function checkInHistory(
  db: ScopedPrisma,
  sheetId: string,
): Promise<CheckInEvent[]> {
  const events = await db.auditEvent.findMany({
    where: { entityType: 'GoalSheet', entityId: sheetId, action: 'goalsheet.checkin' },
    orderBy: { createdAt: 'asc' },
    select: { actorId: true, createdAt: true, before: true, after: true },
  });

  return events.map((event) => {
    const was = new Map(
      goalsOf(event.before).map((goal) => [String(goal.id), goal] as const),
    );

    return {
      at: event.createdAt,
      actorId: event.actorId,
      changes: goalsOf(event.after).flatMap((goal): CheckInChange[] => {
        const previous = was.get(String(goal.id));

        if (previous === undefined) {
          return [];
        }

        const fromActual = text(previous.actualAchievement);
        const toActual = text(goal.actualAchievement);
        const fromStatus = String(previous.status);
        const toStatus = String(goal.status);

        // An unchanged goal is not a change. A check-in posts every goal it can
        // see, so without this the history would read as "all five goals
        // updated" every time somebody touched one.
        if (fromActual === toActual && fromStatus === toStatus) {
          return [];
        }

        return [
          {
            goalId: String(goal.id),
            title: text(goal.title) ?? '',
            fromActual,
            toActual,
            fromStatus,
            toStatus,
          },
        ];
      }),
    };
  });
}
