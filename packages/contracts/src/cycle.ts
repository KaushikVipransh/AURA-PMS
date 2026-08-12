/**
 * Review cycle contracts (PRD E2).
 *
 * The endpoint that replaces `PUT /period`, which the prototype implemented as
 * `updateMany({}, { $set: { quarter } })` over every sheet ever created
 * (PLAN.md F-03).
 */

import { findPhaseOverlaps } from '@aura/core';
import { z } from 'zod';

import {
  cycleStatusSchema,
  escalationRuleSchema,
  idSchema,
  instantSchema,
  phaseKeySchema,
  shortTextSchema,
  timeZoneSchema,
} from './common.js';

export const phaseInputSchema = z
  .object({
    key: phaseKeySchema,
    label: shortTextSchema,
    startsAt: instantSchema,
    endsAt: instantSchema,
  })
  .refine((phase) => phase.startsAt.getTime() < phase.endsAt.getTime(), {
    error: 'A phase must end after it starts.',
    path: ['endsAt'],
  });

/** Rating scale, snapshotted onto the cycle so history never re-scales (US-203). */
export const ratingScaleSchema = z
  .object({
    min: z.int(),
    max: z.int(),
    labels: z.record(z.string(), shortTextSchema),
  })
  .refine((scale) => scale.min < scale.max, {
    error: 'The scale maximum must be above its minimum.',
    path: ['max'],
  })
  .refine(
    (scale) => Object.keys(scale.labels).length === scale.max - scale.min + 1,
    { error: 'Every point on the scale needs a label.', path: ['labels'] },
  );

/** Per-cycle escalation thresholds in days (US-204). */
export const escalationRulesSchema = z
  .object({
    manager: z.int().min(0).max(365),
    skipLevelHr: z.int().min(0).max(365),
    rules: z.array(escalationRuleSchema).min(1),
  })
  .refine((value) => value.manager <= value.skipLevelHr, {
    error: 'The skip-level threshold cannot come before the manager threshold.',
    path: ['skipLevelHr'],
  });

/**
 * Creating a cycle.
 *
 * Phase windows are checked for overlap by the same `findPhaseOverlaps` the
 * resolver uses (W2-03), so a cycle that parses is a cycle `activePhase` can
 * answer unambiguously about — the validation and the reader cannot disagree.
 */
export const createCycleRequestSchema = z
  .object({
    name: shortTextSchema,
    fiscalYear: z.int().min(2000).max(2200),
    timeZone: timeZoneSchema,
    phases: z.array(phaseInputSchema).min(1).max(5),
    ratingScale: ratingScaleSchema,
    escalationRules: escalationRulesSchema,
  })
  .superRefine((cycle, ctx) => {
    const keys = cycle.phases.map((phase) => phase.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Each phase may appear only once in a cycle.',
        path: ['phases'],
      });
    }

    for (const overlap of findPhaseOverlaps(cycle.phases)) {
      ctx.addIssue({
        code: 'custom',
        message: `${overlap.earlier} overlaps ${overlap.later}.`,
        path: ['phases'],
      });
    }
  });

export const updateCycleRequestSchema = z.object({
  name: shortTextSchema.optional(),
  ratingScale: ratingScaleSchema.optional(),
  escalationRules: escalationRulesSchema.optional(),
});

/**
 * Activating a cycle.
 *
 * A separate endpoint from creation rather than a `status` field on the update
 * body: `review_cycles_one_active_per_org` is a partial unique index, so this
 * transition can fail on a constraint and needs its own error path.
 */
export const activateCycleRequestSchema = z.object({
  confirm: z.literal(true, { error: 'Activation must be confirmed explicitly.' }),
});

export const phaseSchema = z.object({
  id: idSchema,
  key: phaseKeySchema,
  label: z.string(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
});

export const cycleSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  name: z.string(),
  fiscalYear: z.int(),
  status: cycleStatusSchema,
  phases: z.array(phaseSchema),
  /** What is open right now, resolved server-side so clients never guess. */
  activePhase: phaseKeySchema.nullable(),
});

export type PhaseInput = z.infer<typeof phaseInputSchema>;
export type RatingScale = z.infer<typeof ratingScaleSchema>;
export type EscalationRulesConfig = z.infer<typeof escalationRulesSchema>;
export type CreateCycleRequest = z.infer<typeof createCycleRequestSchema>;
export type UpdateCycleRequest = z.infer<typeof updateCycleRequestSchema>;
export type ActivateCycleRequest = z.infer<typeof activateCycleRequestSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type Cycle = z.infer<typeof cycleSchema>;
