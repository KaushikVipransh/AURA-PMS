/**
 * Goal and goal-sheet contracts (PRD E3, E6).
 */

import {
  MAX_GOALS_PER_SHEET,
  MIN_GOALS_PER_SHEET,
  validateWeightages,
  type WeightageIssue,
} from '@aura/core';
import { z } from 'zod';

import {
  goalDirectionSchema,
  goalStatusSchema,
  idSchema,
  instantSchema,
  longTextSchema,
  sheetStatusSchema,
  shortTextSchema,
  thrustAreaSchema,
  uomSchema,
  weightageSchema,
} from './common.js';

/**
 * One goal on a sheet.
 *
 * `direction` is required with **no default** — the same decision the Prisma
 * model makes, for the same reason. The prototype inferred it by substring-
 * matching the title, so "Reduce customer wait time" scored inversely by
 * accident (PLAN.md F-06, PRD US-303). A default here would put the guess back,
 * just quieter.
 */
export const goalInputSchema = z.object({
  id: idSchema.optional(),
  thrustArea: thrustAreaSchema,
  title: shortTextSchema,
  uom: uomSchema,
  direction: goalDirectionSchema,
  target: shortTextSchema,
  weightage: weightageSchema,
});

/** Which field on the sheet an issue from `@aura/core` belongs to. */
function pathForIssue(issue: WeightageIssue): (string | number)[] {
  return issue.goalIndex === undefined
    ? ['goals']
    : ['goals', issue.goalIndex, 'weightage'];
}

/**
 * A whole goal sheet, weightage rules included.
 *
 * The rules are not restated here. `validateWeightages` from `@aura/core`
 * (W2-02) is called, and each issue it reports becomes a Zod issue on the
 * offending goal. That matters because the prototype had three different
 * answers to "do these add to 100" — `Math.round(total) !== 100` in one route,
 * a strict `!== 100` in another, and a `>= 100` button guard in the UI
 * (PLAN.md F-10). One implementation, reached from both sides of the wire, is
 * the only way that disagreement cannot come back.
 *
 * The goal-count bounds are declared on the array as well as checked by
 * `validateWeightages`, so the message a form sees is about the array rather
 * than about the total.
 */
export const goalSheetInputSchema = z
  .object({
    cycleId: idSchema,
    goals: z
      .array(goalInputSchema)
      .min(MIN_GOALS_PER_SHEET, {
        error: `A goal sheet needs at least ${String(MIN_GOALS_PER_SHEET)} goals.`,
      })
      .max(MAX_GOALS_PER_SHEET, {
        error: `A goal sheet allows at most ${String(MAX_GOALS_PER_SHEET)} goals.`,
      }),
  })
  .superRefine((sheet, ctx) => {
    for (const issue of validateWeightages(sheet.goals).issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: pathForIssue(issue) });
    }
  });

/** A draft is saved as it is typed, so only the weightage *format* is enforced. */
export const saveDraftRequestSchema = z.object({
  cycleId: idSchema,
  goals: z.array(goalInputSchema).max(MAX_GOALS_PER_SHEET),
});

/** Submitting asserts the sheet is complete, so the full rules apply. */
export const submitSheetRequestSchema = goalSheetInputSchema;

/** US-503 — a manager adjusts weightages inline, and the employee is told. */
export const adjustWeightageRequestSchema = z
  .object({
    adjustments: z
      .array(z.object({ goalId: idSchema, weightage: weightageSchema }))
      .min(1),
    note: longTextSchema,
  })
  .refine(
    (value) =>
      new Set(value.adjustments.map((entry) => entry.goalId)).size === value.adjustments.length,
    { error: 'Each goal may be adjusted only once.', path: ['adjustments'] },
  );

/** US-305 — a returned sheet says exactly what to change. */
export const returnSheetRequestSchema = z.object({
  reason: longTextSchema,
  goalIds: z.array(idSchema).default([]),
});

export const approveSheetRequestSchema = z.object({
  note: longTextSchema.optional(),
});

/**
 * US-601 — reporting achievement.
 *
 * Only `actualAchievement` and `status` can move. The prototype's check-in
 * route trusted the client's entire payload and wrote it over an approved
 * sheet, so a check-in could silently rewrite targets and weightages
 * (PLAN.md F-04). The contract simply does not have room for them.
 */
export const checkInRequestSchema = z.object({
  updates: z
    .array(
      z.object({
        goalId: idSchema,
        actualAchievement: z.string().trim().max(200),
        status: goalStatusSchema,
      }),
    )
    .min(1),
  comment: longTextSchema.optional(),
});

export const goalSchema = z.object({
  id: idSchema,
  sheetId: idSchema,
  thrustArea: thrustAreaSchema,
  title: z.string(),
  uom: uomSchema,
  direction: goalDirectionSchema,
  target: z.string(),
  weightage: z.number(),
  actualAchievement: z.string().nullable(),
  status: goalStatusSchema,
  sharedGoalId: idSchema.nullable(),
  isPrimaryOwner: z.boolean(),
  /** Computed server-side by the W2-01 engine, never in the browser (F-07). */
  score: z.number().min(0).max(1),
});

export const goalSheetSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  userId: idSchema,
  cycleId: idSchema,
  status: sheetStatusSchema,
  goals: z.array(goalSchema),
  totalWeightage: z.number(),
  /** The weighted sheet score, 0–1, from the same engine as each goal's. */
  score: z.number().min(0).max(1),
  submittedAt: z.iso.datetime({ offset: true }).nullable(),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  approvedById: idSchema.nullable(),
});

export const sheetRevisionSchema = z.object({
  id: idSchema,
  sheetId: idSchema,
  reason: z.enum(['SUBMIT', 'APPROVE', 'ADJUST']),
  actorId: idSchema,
  createdAt: z.iso.datetime({ offset: true }),
  snapshot: z.unknown(),
});

export const listSheetsQuerySchema = z.object({
  cycleId: idSchema,
  status: sheetStatusSchema.optional(),
  userId: idSchema.optional(),
  /** US-501 — a manager's queue, most urgent first. */
  awaitingMyAction: z.boolean().default(false),
  dueBefore: instantSchema.optional(),
});

export type GoalInput = z.infer<typeof goalInputSchema>;
export type GoalSheetInput = z.infer<typeof goalSheetInputSchema>;
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;
export type SubmitSheetRequest = z.infer<typeof submitSheetRequestSchema>;
export type AdjustWeightageRequest = z.infer<typeof adjustWeightageRequestSchema>;
export type ReturnSheetRequest = z.infer<typeof returnSheetRequestSchema>;
export type ApproveSheetRequest = z.infer<typeof approveSheetRequestSchema>;
export type CheckInRequest = z.infer<typeof checkInRequestSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type GoalSheet = z.infer<typeof goalSheetSchema>;
export type SheetRevision = z.infer<typeof sheetRevisionSchema>;
export type ListSheetsQuery = z.infer<typeof listSheetsQuerySchema>;
