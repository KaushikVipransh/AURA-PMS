/**
 * The nightly escalation sweep (PRD US-901, US-902) — **closes F-08**.
 *
 * Three things the prototype got wrong, all of them here:
 *
 *   - It ran when an admin clicked a button. This runs on a schedule, and
 *     there is no endpoint anywhere that triggers it.
 *   - It had no deadlines to compare against and floored every result at four
 *     days with `Math.max(elapsed, 4)`, so a sheet saved seconds earlier
 *     reported "4 days overdue". Deadlines here come from `CyclePhase.endsAt`
 *     through W2-04's `deadlineFor`, and the day count is W2-04's `daysOverdue`
 *     — real elapsed calendar days in the subject's own timezone, with no floor.
 *   - Its "notification chain" wrote a status string onto a document and sent
 *     nothing. This enqueues a real dispatch job per breach.
 *
 * **Idempotent by construction.** `@@unique([cycleId, subjectUserId, rule])`
 * means the sweep upserts one row per person per rule per cycle, so running it
 * twice in a day updates rather than duplicates — which is asserted by a test,
 * because "the cron fired twice" is a thing that happens.
 */

import { prisma } from '@aura/db';
import {
  DEFAULT_ESCALATION_THRESHOLDS,
  deadlineFor,
  evaluate,
  type Cycle,
  type CycleAction,
  type EscalationRule,
  type EscalationThresholds,
} from '@aura/core';
import { QUEUES } from '../boss.js';

/**
 * Anything that can enqueue a job.
 *
 * Narrowed to the one method rather than taking a whole `PgBoss`: the sweep
 * needs somewhere to put work, not a queue implementation, and a test that had
 * to satisfy pg-boss's overloaded `send` to check a day count would be
 * testing the wrong thing.
 */
export type JobSender = {
  send(queue: string, data: Record<string, unknown>): Promise<unknown>;
};

/**
 * Which cycle action each rule's deadline comes from.
 *
 * A table rather than a switch, so a rule with no deadline source is a missing
 * key the compiler complains about rather than a case that silently falls
 * through to "not overdue".
 */
const RULE_DEADLINES: Readonly<Record<EscalationRule, CycleAction>> = {
  GOALS_NOT_SUBMITTED: 'SUBMIT_GOAL_SHEET',
  APPROVAL_OVERDUE: 'APPROVE_GOAL_SHEET',
  CHECK_IN_MISSING: 'RECORD_CHECK_IN',
  SELF_APPRAISAL_OVERDUE: 'SUBMIT_SELF_APPRAISAL',
  MANAGER_RATING_OVERDUE: 'SUBMIT_MANAGER_APPRAISAL',
};

export type SweepResult = {
  readonly cyclesEvaluated: number;
  readonly breaches: number;
  readonly raised: number;
  readonly notified: number;
};

/** Read per-cycle thresholds, falling back to the documented defaults. */
export function readThresholds(value: unknown): EscalationThresholds {
  const rules = value as { manager?: unknown; skipLevelHr?: unknown } | null;

  if (
    rules === null ||
    !Number.isInteger(rules.manager) ||
    !Number.isInteger(rules.skipLevelHr)
  ) {
    return DEFAULT_ESCALATION_THRESHOLDS;
  }

  return { manager: rules.manager as number, skipLevelHr: rules.skipLevelHr as number };
}

/**
 * Whether a person has breached a rule, given the state of their sheet.
 *
 * Returns the *subjects* in breach rather than a boolean per person, because
 * the rules differ in who they are about: an unsubmitted sheet is the
 * employee's breach, an unapproved one is their manager's.
 */
type Breach = { readonly rule: EscalationRule; readonly subjectUserId: string };

function breachesFor(sheet: {
  userId: string;
  status: string;
  approverId: string | null;
  user: { managerId: string | null };
  goals: { actualAchievement: string | null }[];
  appraisal: { selfSubmittedAt: Date | null; managerSubmittedAt: Date | null } | null;
}): Breach[] {
  const breaches: Breach[] = [];

  if (sheet.status === 'DRAFT' || sheet.status === 'RETURNED') {
    breaches.push({ rule: 'GOALS_NOT_SUBMITTED', subjectUserId: sheet.userId });
  }

  /*
   * An unapproved submitted sheet is the *manager's* breach, not the
   * employee's. The prototype had no reporting line at all, so it could not
   * have made this distinction; getting it wrong here would chase the person
   * who already did their part.
   */
  if (sheet.status === 'PENDING' && sheet.user.managerId !== null) {
    breaches.push({ rule: 'APPROVAL_OVERDUE', subjectUserId: sheet.user.managerId });
  }

  if (sheet.status === 'APPROVED' && sheet.goals.every((goal) => goal.actualAchievement === null)) {
    breaches.push({ rule: 'CHECK_IN_MISSING', subjectUserId: sheet.userId });
  }

  if (sheet.status === 'APPROVED' && (sheet.appraisal?.selfSubmittedAt ?? null) === null) {
    breaches.push({ rule: 'SELF_APPRAISAL_OVERDUE', subjectUserId: sheet.userId });
  }

  if (
    sheet.status === 'APPROVED' &&
    (sheet.appraisal?.managerSubmittedAt ?? null) === null &&
    sheet.user.managerId !== null
  ) {
    breaches.push({ rule: 'MANAGER_RATING_OVERDUE', subjectUserId: sheet.user.managerId });
  }

  return breaches;
}

/**
 * Sweep every active cycle for missed deadlines.
 *
 * `boss` is optional so the sweep can be tested for what it *decides* without
 * a queue attached. That is deliberate: the decision is the part with rules in
 * it, and a test that had to stand up a queue to check a day count would be
 * testing the wrong thing.
 */
export async function runEscalationSweep(
  now: Date = new Date(),
  boss?: JobSender,
): Promise<SweepResult> {
  const cycles = await prisma.reviewCycle.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      orgId: true,
      status: true,
      escalationRules: true,
      phases: { select: { key: true, startsAt: true, endsAt: true } },
    },
  });

  let breaches = 0;
  let raised = 0;
  let notified = 0;

  for (const cycle of cycles) {
    const thresholds = readThresholds(cycle.escalationRules);
    const asCycle: Cycle = { status: 'ACTIVE', phases: cycle.phases };

    const sheets = await prisma.goalSheet.findMany({
      where: { cycleId: cycle.id },
      select: {
        userId: true,
        status: true,
        approverId: true,
        user: { select: { managerId: true } },
        goals: { select: { actualAchievement: true } },
        appraisal: { select: { selfSubmittedAt: true, managerSubmittedAt: true } },
      },
    });

    const existing = await prisma.escalation.findMany({
      where: { cycleId: cycle.id },
      select: {
        id: true,
        rule: true,
        subjectUserId: true,
        status: true,
        tier: true,
        notifiedAt: true,
      },
    });

    /* Keyed by subject and rule, which is the same natural key the unique
       constraint uses -- typed as a plain string so the map is not narrowed to
       the template-literal union the compiler would otherwise infer. */
    const priorOf = new Map<string, (typeof existing)[number]>(
      existing.map((row) => [`${row.subjectUserId}:${row.rule}`, row]),
    );

    /* One lookup for every subject's timezone, rather than one per breach.
       The zone matters: someone in Auckland and someone in Los Angeles do not
       cross midnight together, and "days overdue" is a calendar-day count. */
    const subjectIds = [
      ...new Set(sheets.flatMap((sheet) => breachesFor(sheet).map((breach) => breach.subjectUserId))),
    ];
    const zones = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: subjectIds } },
          select: { id: true, timeZone: true },
        })
      ).map((user) => [user.id, user.timeZone]),
    );

    for (const sheet of sheets) {
      for (const breach of breachesFor(sheet)) {
        const dueAt = deadlineFor(RULE_DEADLINES[breach.rule], asCycle);

        // A cycle with no phase for this rule has no deadline to miss. Not an
        // error, and emphatically not a breach.
        if (dueAt === null) {
          continue;
        }

        const key = `${breach.subjectUserId}:${breach.rule}`;
        const prior = priorOf.get(key);

        const decision = evaluate(
          {
            rule: breach.rule,
            subjectUserId: breach.subjectUserId,
            dueAt,
            status: prior?.status ?? 'ACTIVE',
            tier: prior?.tier ?? 'EMPLOYEE',
            notifiedAt: prior?.notifiedAt ?? [],
          },
          thresholds,
          now,
          zones.get(breach.subjectUserId) ?? 'UTC',
        );

        if (!decision.overdue) {
          continue;
        }

        breaches += 1;

        /*
         * Upsert on the natural key. Running twice in one day updates the row
         * rather than piling up duplicates, which is what
         * `@@unique([cycleId, subjectUserId, rule])` exists to guarantee — and
         * a cron that fires twice is a thing that happens.
         */
        const row = await prisma.escalation.upsert({
          where: {
            cycleId_subjectUserId_rule: {
              cycleId: cycle.id,
              subjectUserId: breach.subjectUserId,
              rule: breach.rule,
            },
          },
          create: {
            orgId: cycle.orgId,
            cycleId: cycle.id,
            subjectUserId: breach.subjectUserId,
            rule: breach.rule,
            tier: decision.tier,
            dueAt,
          },
          update: {
            tier: decision.tier,
            dueAt,
            /* A resolved escalation whose condition recurs re-opens on this
               same row — US-904's "re-opens automatically", with no second
               table to keep in step. */
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        raised += 1;

        if (!decision.notify) {
          continue;
        }

        await prisma.escalation.update({
          where: { id: row.id },
          // Appended only when a send is actually enqueued, so the array is a
          // record of deliveries rather than of intentions (US-1203).
          data: { notifiedAt: { push: now } },
        });

        await boss?.send(QUEUES.notificationDispatch, {
          orgId: cycle.orgId,
          userId: breach.subjectUserId,
          type: `escalation.${breach.rule.toLowerCase()}`,
          mandatory: true,
          payload: {
            escalationId: row.id,
            cycleId: cycle.id,
            rule: breach.rule,
            tier: decision.tier,
            daysOverdue: String(decision.daysOverdue),
          },
        });

        notified += 1;
      }
    }
  }

  return { cyclesEvaluated: cycles.length, breaches, raised, notified };
}
