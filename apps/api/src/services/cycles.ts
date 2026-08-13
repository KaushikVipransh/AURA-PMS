/**
 * Review cycle mutations (PRD US-201, US-202, US-203, US-204).
 *
 * The replacement for `PUT /period`, which the prototype implemented as
 * `updateMany({}, { $set: { quarter } })` over every sheet ever created — a
 * dropdown that rewrote history (PLAN.md F-03). A cycle here is a row. Closing
 * one leaves it readable forever.
 */

import { findPhaseOverlaps, type AuditActor } from '@aura/core';
import type { CreateCycleRequest, UpdateCycleRequest } from '@aura/contracts';

import type { ScopedPrisma } from '../db/scoped.js';
import { withAudit } from './withAudit.js';

const CYCLE_VIEW = {
  id: true,
  name: true,
  fiscalYear: true,
  status: true,
  ratingScale: true,
  escalationRules: true,
} as const;

/** Raised when a cycle cannot be created or moved as asked. */
export class CycleConflictError extends Error {
  readonly code: 'PHASES_OVERLAP' | 'ALREADY_ACTIVE' | 'NOT_DRAFT' | 'DUPLICATE_NAME';

  constructor(code: CycleConflictError['code'], message: string) {
    super(message);
    this.name = 'CycleConflictError';
    this.code = code;
  }
}

export async function createCycle(
  db: ScopedPrisma,
  actor: AuditActor,
  input: CreateCycleRequest,
) {
  /*
   * Checked here as well as in the Zod schema.
   *
   * Not redundancy for its own sake: the schema guards the HTTP boundary, and
   * this guards the service, which W5's jobs and any future importer will call
   * without going through a request body. Both call the same
   * `findPhaseOverlaps` from W2-03, so they cannot disagree about what overlap
   * means.
   */
  const overlaps = findPhaseOverlaps(input.phases);

  if (overlaps.length > 0) {
    const [first] = overlaps;
    throw new CycleConflictError(
      'PHASES_OVERLAP',
      `${String(first?.earlier)} overlaps ${String(first?.later)}.`,
    );
  }

  return withAudit(db, actor, { action: 'cycle.create', entityType: 'ReviewCycle' }, async (tx) => {
    const existing = await tx.reviewCycle.count({ where: { name: input.name } });

    if (existing > 0) {
      throw new CycleConflictError(
        'DUPLICATE_NAME',
        `This organization already has a cycle named "${input.name}".`,
      );
    }

    const created = await tx.reviewCycle.create({
      data: {
        orgId: actor.orgId,
        name: input.name,
        fiscalYear: input.fiscalYear,
        // Snapshotted onto the cycle, never referenced, so changing the scale
        // later cannot rewrite a historical rating (US-203).
        ratingScale: input.ratingScale,
        escalationRules: input.escalationRules,
        phases: {
          create: input.phases.map((phase) => ({
            key: phase.key,
            label: phase.label,
            startsAt: phase.startsAt,
            endsAt: phase.endsAt,
          })),
        },
      },
      select: { ...CYCLE_VIEW, phases: true },
    });

    return { value: created, after: created, entityId: created.id };
  });
}

export async function updateCycle(
  db: ScopedPrisma,
  actor: AuditActor,
  cycleId: string,
  input: UpdateCycleRequest,
) {
  return withAudit(
    db,
    actor,
    { action: 'cycle.update', entityType: 'ReviewCycle', entityId: cycleId },
    async (tx) => {
      const before = await tx.reviewCycle.findUniqueOrThrow({
        where: { id: cycleId },
        select: CYCLE_VIEW,
      });

      const after = await tx.reviewCycle.update({
        where: { id: cycleId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.ratingScale === undefined ? {} : { ratingScale: input.ratingScale }),
          ...(input.escalationRules === undefined
            ? {}
            : { escalationRules: input.escalationRules }),
        },
        select: CYCLE_VIEW,
      });

      return { value: after, before, after };
    },
  );
}

/**
 * Move a cycle to `ACTIVE` (PRD US-202).
 *
 * The `review_cycles_one_active_per_org` partial unique index means the
 * database refuses a second active cycle outright, so this cannot be raced
 * into an inconsistent state by two concurrent requests. The check below exists
 * to turn that constraint violation into a message a person can act on.
 */
export async function activateCycle(db: ScopedPrisma, actor: AuditActor, cycleId: string) {
  return withAudit(
    db,
    actor,
    { action: 'cycle.activate', entityType: 'ReviewCycle', entityId: cycleId },
    async (tx) => {
      const before = await tx.reviewCycle.findUniqueOrThrow({
        where: { id: cycleId },
        select: CYCLE_VIEW,
      });

      if (before.status !== 'DRAFT') {
        throw new CycleConflictError(
          'NOT_DRAFT',
          `Only a draft cycle can be activated; this one is ${before.status}.`,
        );
      }

      const active = await tx.reviewCycle.count({ where: { status: 'ACTIVE' } });

      if (active > 0) {
        throw new CycleConflictError(
          'ALREADY_ACTIVE',
          'Another cycle is already active. Close it before activating this one.',
        );
      }

      const after = await tx.reviewCycle.update({
        where: { id: cycleId },
        data: { status: 'ACTIVE' },
        select: CYCLE_VIEW,
      });

      return { value: after, before, after };
    },
  );
}

/** Close a cycle. Its rows stay readable — that is the point of US-202. */
export async function closeCycle(db: ScopedPrisma, actor: AuditActor, cycleId: string) {
  return withAudit(
    db,
    actor,
    { action: 'cycle.close', entityType: 'ReviewCycle', entityId: cycleId },
    async (tx) => {
      const before = await tx.reviewCycle.findUniqueOrThrow({
        where: { id: cycleId },
        select: CYCLE_VIEW,
      });

      const after = await tx.reviewCycle.update({
        where: { id: cycleId },
        data: { status: 'CLOSED' },
        select: CYCLE_VIEW,
      });

      return { value: after, before, after };
    },
  );
}
