/**
 * The guard for a duplication that could not be avoided.
 *
 * Every enum in the schema exists three times: once in Prisma, once as an
 * `as const` array in `@aura/core`, and once as a `z.enum` in
 * `@aura/contracts`. That is not carelessness — `@aura/core` may not import
 * `@aura/db` (the purity rule from W0-03 is what lets it be tested without a
 * database), and `@aura/contracts` builds its schemas from core's arrays for
 * exactly this reason, which collapses three copies to two.
 *
 * Two copies can still drift, and drift here is quiet: adding a `PhaseKey` in
 * Prisma and forgetting core would leave a phase the resolver cannot name and
 * an API that rejects a value the database accepts. This file is the only
 * place all of them can be compared, because `packages/db` is allowed to
 * import both.
 *
 * It was owed from W2-01 and paid here with W2-10, when the third copy arrived.
 */

import {
  CYCLE_STATUSES,
  ESCALATION_RULES,
  ESCALATION_STATUSES,
  ESCALATION_TIERS,
  GOAL_DIRECTIONS,
  GOAL_STATUSES,
  PHASE_KEYS,
  ROLES,
  UOMS,
} from '@aura/core';
import {
  cycleStatusSchema,
  escalationRuleSchema,
  escalationStatusSchema,
  escalationTierSchema,
  goalDirectionSchema,
  goalStatusSchema,
  notificationChannelSchema,
  notificationStatusSchema,
  phaseKeySchema,
  revisionReasonSchema,
  roleSchema,
  sheetStatusSchema,
  thrustAreaSchema,
  uomSchema,
  userStatusSchema,
} from '@aura/contracts';
import { describe, expect, it } from 'vitest';

import {
  CycleStatus,
  EscalationRule,
  EscalationStatus,
  EscalationTier,
  GoalDirection,
  GoalStatus,
  NotificationChannel,
  NotificationStatus,
  PhaseKey,
  RevisionReason,
  Role,
  SheetStatus,
  ThrustArea,
  Uom,
  UserStatus,
} from '../generated/prisma/enums.js';

/** Order is not part of an enum's meaning; membership is. */
const members = (values: readonly string[]): string[] => [...values].sort();

type Case = {
  readonly name: string;
  readonly prisma: Record<string, string>;
  /** The `as const` array in `@aura/core`, where the enum has behaviour. */
  readonly core: readonly string[] | null;
  /** The `z.enum` in `@aura/contracts`. */
  readonly contract: readonly string[];
};

const CASES: readonly Case[] = [
  { name: 'Role', prisma: Role, core: ROLES, contract: roleSchema.options },
  { name: 'Uom', prisma: Uom, core: UOMS, contract: uomSchema.options },
  {
    name: 'GoalDirection',
    prisma: GoalDirection,
    core: GOAL_DIRECTIONS,
    contract: goalDirectionSchema.options,
  },
  {
    name: 'GoalStatus',
    prisma: GoalStatus,
    core: GOAL_STATUSES,
    contract: goalStatusSchema.options,
  },
  {
    name: 'CycleStatus',
    prisma: CycleStatus,
    core: CYCLE_STATUSES,
    contract: cycleStatusSchema.options,
  },
  { name: 'PhaseKey', prisma: PhaseKey, core: PHASE_KEYS, contract: phaseKeySchema.options },
  {
    name: 'EscalationRule',
    prisma: EscalationRule,
    core: ESCALATION_RULES,
    contract: escalationRuleSchema.options,
  },
  {
    name: 'EscalationTier',
    prisma: EscalationTier,
    core: ESCALATION_TIERS,
    contract: escalationTierSchema.options,
  },
  {
    name: 'EscalationStatus',
    prisma: EscalationStatus,
    core: ESCALATION_STATUSES,
    contract: escalationStatusSchema.options,
  },

  /* No behaviour in @aura/core, so these live in contracts only. */
  { name: 'ThrustArea', prisma: ThrustArea, core: null, contract: thrustAreaSchema.options },
  { name: 'SheetStatus', prisma: SheetStatus, core: null, contract: sheetStatusSchema.options },
  { name: 'UserStatus', prisma: UserStatus, core: null, contract: userStatusSchema.options },
  {
    name: 'RevisionReason',
    prisma: RevisionReason,
    core: null,
    contract: revisionReasonSchema.options,
  },
  {
    name: 'NotificationChannel',
    prisma: NotificationChannel,
    core: null,
    contract: notificationChannelSchema.options,
  },
  {
    name: 'NotificationStatus',
    prisma: NotificationStatus,
    core: null,
    contract: notificationStatusSchema.options,
  },
];

describe('enums do not drift between Prisma, @aura/core and @aura/contracts', () => {
  it.each(CASES)('$name matches in every package that declares it', (subject) => {
    const prisma = members(Object.values(subject.prisma));

    expect(members(subject.contract)).toEqual(prisma);

    if (subject.core !== null) {
      expect(members(subject.core)).toEqual(prisma);
    }
  });

  it('covers every enum the schema declares', () => {
    // If a new enum is added to the schema without a case here, this fails --
    // which is the point. Update the count deliberately, with the new case.
    expect(CASES).toHaveLength(15);
  });

  it('reads its Prisma side from the generated client, not from a copy', () => {
    // A test that compared two hand-written lists would pass forever while the
    // database said something else.
    expect(Object.values(Role)).toContain('ORG_ADMIN');
    expect(Object.keys(Role)).toEqual(Object.values(Role));
  });
});
