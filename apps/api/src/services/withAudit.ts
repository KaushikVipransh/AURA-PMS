/**
 * Every mutation and its audit record, committed together or not at all.
 *
 * The prototype logged one action out of a dozen mutations and attributed it to
 * the string "System Compliance Board" (PLAN.md F-09). Approvals, reworks,
 * weightage adjustments, cascades and period changes left no trace at all.
 *
 * The failure mode this guards against is subtler than "we forgot to log". It
 * is the audit trail that is *mostly* right: a write succeeds, its audit insert
 * fails for whatever reason, nobody notices, and six months later the trail is
 * used to settle a dispute while quietly missing the row that matters. A trail
 * with unknown gaps is worse than no trail, because it is believed.
 *
 * So the audit write is inside the same transaction as the mutation. If it
 * fails, the mutation rolls back — the change never happened, which is a state
 * the system can describe honestly (PRD US-1101).
 */

import { buildAuditEvent, type AuditActor } from '@aura/core';
import type { ScopedPrisma } from '../db/scoped.js';

/** The transactional client handed to a mutation body. */
export type AuditedTx = Omit<
  ScopedPrisma,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type AuditSpec = {
  /** Dotted verb, e.g. `goalsheet.approve`. */
  readonly action: string;
  readonly entityType: string;
  /** Known up front for an update; supplied by the body for a create. */
  readonly entityId?: string;
};

export type AuditOutcome<T> = {
  /** What the caller gets back. */
  readonly value: T;
  /** State before the change. Omit or `{}` for a create. */
  readonly before?: unknown;
  /** State after. Omit for a delete. */
  readonly after?: unknown;
  /** Required when the id is only known after the write. */
  readonly entityId?: string;
};

/** Raised when a mutation body does not identify what it changed. */
export class MissingAuditTargetError extends Error {
  constructor(action: string) {
    super(
      `The mutation "${action}" produced no entityId. Supply one in the AuditSpec ` +
        'or return it from the body — an audit row nobody can look up is not an audit row.',
    );
    this.name = 'MissingAuditTargetError';
  }
}

/**
 * Run a mutation and record it.
 *
 * The body receives a transactional client. **Every write it makes must go
 * through that client**, not through the ambient one — a write on the outer
 * client is outside the transaction and will survive a rollback, which
 * reintroduces exactly the gap this exists to close.
 *
 * Returns whatever the body's `value` is. A change that turns out to be a no-op
 * writes no audit row (`buildAuditEvent` returns `null` for an empty diff),
 * because a trail recording saves that altered nothing trains people to ignore
 * it.
 */
export async function withAudit<T>(
  db: ScopedPrisma,
  actor: AuditActor,
  spec: AuditSpec,
  body: (tx: AuditedTx) => Promise<AuditOutcome<T>>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const outcome = await body(tx);
    const entityId = outcome.entityId ?? spec.entityId;

    if (entityId === undefined || entityId === '') {
      throw new MissingAuditTargetError(spec.action);
    }

    const event = buildAuditEvent(
      actor,
      spec.action,
      { entityType: spec.entityType, entityId },
      outcome.before ?? {},
      outcome.after ?? {},
    );

    if (event !== null) {
      await tx.auditEvent.create({
        data: {
          orgId: event.orgId,
          actorId: event.actorId,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          /* Cast because `unknown` values in the diff are JSON-shaped by
             construction -- `buildAuditEvent` serialises Dates to ISO strings
             and never emits a function or a symbol. */
          before: event.before as Record<string, string>,
          after: event.after as Record<string, string>,
          ip: event.ip,
          userAgent: event.userAgent,
        },
      });
    }

    return outcome.value;
  });
}
