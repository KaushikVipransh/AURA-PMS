/**
 * Appraisal, calibration and shared-goal contracts (PRD E4, E7, E8).
 */

import { z } from 'zod';

import { idSchema, longTextSchema } from './common.js';
import { ratingScaleSchema } from './cycle.js';

/*
 * The shared-goal and cascade contracts used to live here, sketched in W1
 * before there was an endpoint behind them. They have moved to `goal.js`,
 * where W4-13 implements them.
 *
 * The sketch is gone rather than kept alongside, and the reason is worth
 * recording: it declared its own inline copy of the cascade skip reasons, so
 * `SHEET_NOT_EDITABLE` and `NOT_IN_YOUR_LINE` could be added to `@aura/core`
 * and this file would still have compiled, still have passed its tests, and
 * still have rejected a response the server can now legitimately produce. Two
 * lists of the same thing is the shape of F-10, and the replacement builds its
 * enum from `CASCADE_SKIP_REASONS` so there is only one.
 */

/**
 * US-701 — the self-appraisal, one entry per goal plus an overall note.
 *
 * `selfRating` is optional because the story says so: an employee may reflect
 * without putting a number on themselves. The manager's rating is not optional
 * (see below), which is the asymmetry the two stories describe.
 */
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
  selfRating: z.int().optional(),
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
        rating: z.int(),
        commentary: longTextSchema,
      }),
    )
    .min(1),
  overallRating: z.int(),
  justification: longTextSchema,
});

/**
 * US-802 — a calibration adjustment, with a mandatory reason.
 *
 * The bounds are **not** stated here, deliberately. A rating is only meaningful
 * against the scale its cycle was created with (US-203), and a schema asserting
 * 0–10 would accept a 7 on a 1–5 cycle — a number that parses and means
 * nothing. The service checks it against the snapshotted scale, which is the
 * only place that knows what the number is supposed to mean.
 */
export const calibrationAdjustmentRequestSchema = z.object({
  appraisalId: idSchema,
  finalRating: z.int(),
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

/**
 * US-704 — a manager rating far from the computed score, flagged for review.
 *
 * Both numbers are carried, not just the gap. "Diverges by 2" is not something
 * a calibration meeting can discuss; "the engine says 0.41 and the manager
 * says 4 of 5" is.
 */
export const divergenceSchema = z.object({
  appraisalId: idSchema,
  sheetId: idSchema,
  userId: idSchema,
  userName: z.string(),
  managerId: idSchema.nullable(),
  /** The W2-01 engine's weighted number, 0–1. */
  computedScore: z.number().min(0).max(1),
  /** The same score placed on the cycle's scale, so the two are comparable. */
  computedOnScale: z.number(),
  managerRating: z.number(),
  divergence: z.number(),
});

/**
 * US-801, US-704 — everything a calibration meeting is run from.
 *
 * One response rather than three endpoints, because the distribution, the
 * per-manager breakdown and the outliers are read together or not at all.
 */
export const calibrationViewSchema = z.object({
  cycleId: idSchema,
  scale: ratingScaleSchema,
  /** Org-wide counts, one entry per point on the scale. */
  distribution: z.array(z.object({ rating: z.int(), count: z.int().min(0) })),
  /** The same counts split by manager, with each manager's mean. */
  byManager: z.array(
    z.object({
      managerId: idSchema.nullable(),
      managerName: z.string(),
      count: z.int().min(0),
      mean: z.number(),
      /** True when this manager's mean is far from the organization's. */
      outlier: z.boolean(),
    }),
  ),
  orgMean: z.number(),
  divergences: z.array(divergenceSchema),
  total: z.int().min(0),
});

export const releaseResultsResponseSchema = z.object({
  released: z.int().min(0),
  /** Appraisals with no final rating, which release refuses to publish. */
  incomplete: z.array(z.object({ sheetId: idSchema, userName: z.string() })),
});

export type SelfAppraisalRequest = z.infer<typeof selfAppraisalRequestSchema>;
export type ManagerRatingRequest = z.infer<typeof managerRatingRequestSchema>;
export type CalibrationAdjustmentRequest = z.infer<typeof calibrationAdjustmentRequestSchema>;
export type AcknowledgeRatingRequest = z.infer<typeof acknowledgeRatingRequestSchema>;
export type ReleaseResultsRequest = z.infer<typeof releaseResultsRequestSchema>;
export type Appraisal = z.infer<typeof appraisalSchema>;
export type RatingDistribution = z.infer<typeof ratingDistributionSchema>;
export type Divergence = z.infer<typeof divergenceSchema>;
export type CalibrationView = z.infer<typeof calibrationViewSchema>;
export type ReleaseResultsResponse = z.infer<typeof releaseResultsResponseSchema>;
