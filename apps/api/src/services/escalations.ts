/**
 * Escalation resolution (PRD US-904).
 *
 * The detection engine is W2-08 and the nightly job that drives it is W5-03.
 * This is the human end: someone looks at a breach and says what they did
 * about it.
 */

import type { AuditActor } from '@aura/core';

import type { ScopedPrisma } from '../db/scoped.js';
import { withAudit } from './withAudit.js';

const ESCALATION_VIEW = {
  id: true,
  cycleId: true,
  subjectUserId: true,
  rule: true,
  tier: true,
  status: true,
  dueAt: true,
  notifiedAt: true,
  resolvedById: true,
  resolvedAt: true,
  resolutionNote: true,
} as const;

export class EscalationStateError extends Error {
  readonly code: 'ALREADY_RESOLVED';

  constructor(code: EscalationStateError['code'], message: string) {
    super(message);
    this.name = 'EscalationStateError';
    this.code = code;
  }
}

/**
 * US-904 — resolve an escalation with a note, and stop it notifying.
 *
 * The note is required by the signature rather than by the schema alone. A
 * resolution with no explanation is indistinguishable from someone clearing
 * their dashboard, which is the behaviour a compliance trail exists to make
 * visible.
 *
 * **Resolving does not delete.** The row stays, with who resolved it and when,
 * and `@@unique([cycleId, subjectUserId, rule])` means the nightly job updates
 * this same row if the condition recurs — which is how US-904's "re-opens
 * automatically" works without a second table to keep in step.
 */
export async function resolveEscalation(
  db: ScopedPrisma,
  actor: AuditActor,
  escalationId: string,
  note: string,
) {
  return withAudit(
    db,
    actor,
    { action: 'escalation.resolve', entityType: 'Escalation', entityId: escalationId },
    async (tx) => {
      const before = await tx.escalation.findUniqueOrThrow({
        where: { id: escalationId },
        select: ESCALATION_VIEW,
      });

      if (before.status === 'RESOLVED') {
        throw new EscalationStateError(
          'ALREADY_RESOLVED',
          'This escalation has already been resolved.',
        );
      }

      const after = await tx.escalation.update({
        where: { id: escalationId },
        data: {
          status: 'RESOLVED',
          resolvedById: actor.userId,
          resolvedAt: new Date(),
          resolutionNote: note,
        },
        select: ESCALATION_VIEW,
      });

      return { value: after, before, after };
    },
  );
}
