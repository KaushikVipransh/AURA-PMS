/**
 * Appraisal, calibration and shared-goal contracts (PRD E4, E7, E8).
 */

import { z } from 'zod';

import {
  goalDirectionSchema,
  idSchema,
  longTextSchema,
  shortTextSchema,
  thrustAreaSchema,
  uomSchema,
  weightageSchema,
} from './common.js';

/** US-401 — a departmental KPI pushed to a team. */
export const createSharedGoalRequestSchema = z.object({
  cycleId: idSchema,
  thrustArea: thrustAreaSchema,
  title: shortTextSchema,
  uom: uomSchema,
  direction: goalDirectionSchema,
  target: shortTextSchema,
  weightage: weightageSchema,
  /** Owner by id. The prototype matched by display name (PLAN.md F-05). */
  ownerUserId: idSchema,
});

export const cascadeRequestSchema = z.object({
  recipientUserIds: z.array(idSchema).min(1).max(500),
  /** Plan only. The plan is shown, then applied by a second call. */
  dryRun: z.boolean().default(true),
});

/**
 * The plan, not the outcome (US-402).
 *
 * Every recipient appears in exactly one of the two lists, so a manager can see
 * who will miss out and why before anything is written.
 */
export const cascadePlanSchema = z.object({
  sharedGoalId: idSchema,
  weightage: z.number(),
  willReceive: z.array(idSchema),
  skipped: z.array(
    z.object({
      userId: idSchema,
      reason: z.enum([
        'DUPLICATE_RECIPIENT',
        'IS_OWNER',
        'ALREADY_HAS_GOAL',
        'INVALID_WEIGHTAGE',
        'WOULD_EXCEED_GOAL_LIMIT',
        'WOULD_EXCEED_WEIGHTAGE',
      ]),
      detail: z.string(),
    }),
  ),
});

/** US-701 — the self-appraisal, one entry per goal plus an overall note. */
export const selfAppraisalRequestSchema = z.object({
  entries: z
    .array(
      z.object({
        goalId: idSchema,
        commentary: longTextSchema,
      }),
    )
    .min(1),
  summary: longTextSchema,
});

/**
 * US-702 — the manager's rating.
 *
 * `justification` is required rather than optional. A rating with no reason is
 * what a disputed appraisal turns on, and making it optional means it is absent
 * exactly when it is needed.
 */
export const managerRatingRequestSchema = z.object({
  ratings: z
    .array(
      z.object({
        goalId: idSchema,
        rating: z.number().min(0).max(10),
        commentary: longTextSchema,
      }),
    )
    .min(1),
  overallRating: z.number().min(0).max(10),
  justification: longTextSchema,
});

/** US-802 — a calibration adjustment, with a mandatory reason. */
export const calibrationAdjustmentRequestSchema = z.object({
  appraisalId: idSchema,
  finalRating: z.number().min(0).max(10),
  reason: longTextSchema,
});

/** US-703 — the employee acknowledges, optionally disagreeing on the record. */
export const acknowledgeRatingRequestSchema = z.object({
  acknowledged: z.literal(true),
  comment: longTextSchema.optional(),
});

/** US-803 — lock calibration and release results org-wide, in one action. */
export const releaseResultsRequestSchema = z.object({
  cycleId: idSchema,
  confirm: z.literal(true, { error: 'Releasing results must be confirmed explicitly.' }),
});

/**
 * Four stages kept side by side, never overwritten.
 *
 * A manager's 3 stays readable after calibration moves the final to 4 — which
 * is the difference between an audit trail and a rewrite (PRD US-704, US-802).
 */
export const appraisalSchema = z.object({
  id: idSchema,
  sheetId: idSchema,
  userId: idSchema,
  cycleId: idSchema,
  /** The W2-01 engine's weighted number, 0–1. */
  computedScore: z.number().min(0).max(1),
  selfSummary: z.string().nullable(),
  managerRating: z.number().nullable(),
  managerJustification: z.string().nullable(),
  finalRating: z.number().nullable(),
  calibrationReason: z.string().nullable(),
  acknowledgedAt: z.iso.datetime({ offset: true }).nullable(),
});

/** US-801 — the distribution a calibration meeting is run from. */
export const ratingDistributionSchema = z.object({
  cycleId: idSchema,
  buckets: z.array(
    z.object({
      rating: z.number(),
      count: z.int().min(0),
      managerId: idSchema.nullable(),
    }),
  ),
  total: z.int().min(0),
});

export type CreateSharedGoalRequest = z.infer<typeof createSharedGoalRequestSchema>;
export type CascadeRequest = z.infer<typeof cascadeRequestSchema>;
export type CascadePlanResponse = z.infer<typeof cascadePlanSchema>;
export type SelfAppraisalRequest = z.infer<typeof selfAppraisalRequestSchema>;
export type ManagerRatingRequest = z.infer<typeof managerRatingRequestSchema>;
export type CalibrationAdjustmentRequest = z.infer<typeof calibrationAdjustmentRequestSchema>;
export type AcknowledgeRatingRequest = z.infer<typeof acknowledgeRatingRequestSchema>;
export type ReleaseResultsRequest = z.infer<typeof releaseResultsRequestSchema>;
export type Appraisal = z.infer<typeof appraisalSchema>;
export type RatingDistribution = z.infer<typeof ratingDistributionSchema>;
