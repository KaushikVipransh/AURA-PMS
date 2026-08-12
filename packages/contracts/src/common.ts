/**
 * The pieces every other contract file is built from.
 *
 * Validation lives here, once, and both sides of the wire import it. The
 * prototype validated in the browser and trusted the result on the server —
 * a check-in route accepted the client's entire payload and wrote it over a
 * locked sheet (PLAN.md F-04). A schema that the API parses with is not a
 * convenience for the form; it is the only thing standing between a request
 * and the database.
 */

import {
  GOAL_DIRECTIONS,
  GOAL_STATUSES,
  UOMS,
  CYCLE_STATUSES,
  ESCALATION_RULES,
  ESCALATION_STATUSES,
  ESCALATION_TIERS,
  PHASE_KEYS,
  ROLES,
} from '@aura/core';
import { z } from 'zod';

/*
 * Enums are built from `@aura/core`'s exported arrays rather than retyped.
 * Core already mirrors the Prisma enums because the purity rule forbids it
 * importing `@aura/db`; a third copy here would be a third thing to keep in
 * step. A drift test in `packages/db` compares the generated Prisma enums
 * against these, which is the one place all three can be seen at once.
 */
export const roleSchema = z.enum(ROLES);
export const uomSchema = z.enum(UOMS);
export const goalDirectionSchema = z.enum(GOAL_DIRECTIONS);
export const goalStatusSchema = z.enum(GOAL_STATUSES);
export const cycleStatusSchema = z.enum(CYCLE_STATUSES);
export const phaseKeySchema = z.enum(PHASE_KEYS);
export const escalationRuleSchema = z.enum(ESCALATION_RULES);
export const escalationTierSchema = z.enum(ESCALATION_TIERS);
export const escalationStatusSchema = z.enum(ESCALATION_STATUSES);

/* These have no behaviour in `@aura/core`, so they are declared here and
   covered by the same drift test. */
export const THRUST_AREAS = [
  'BUSINESS_GROWTH',
  'OPERATIONAL_EXCELLENCE',
  'TECHNOLOGY_AND_INNOVATION',
  'COMPLIANCE_AND_RISK',
] as const;
export const thrustAreaSchema = z.enum(THRUST_AREAS);

export const SHEET_STATUSES = ['DRAFT', 'PENDING', 'RETURNED', 'APPROVED'] as const;
export const sheetStatusSchema = z.enum(SHEET_STATUSES);

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'DEACTIVATED'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);

export const REVISION_REASONS = ['SUBMIT', 'APPROVE', 'ADJUST'] as const;
export const revisionReasonSchema = z.enum(REVISION_REASONS);

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SUPPRESSED'] as const;
export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);

/** Every id in the schema is a `cuid()`. */
export const idSchema = z.cuid({ error: 'Must be a valid id.' });

/**
 * Emails are trimmed and lowercased before they are validated.
 *
 * `@@unique([orgId, email])` is case-sensitive in Postgres, so without the
 * lowercasing a user could be invited twice under two spellings of the same
 * address and the database would accept both.
 *
 * The order matters and is the reason this is a `.pipe` rather than a
 * `.transform`: normalising *after* validation rejects `" a@b.com "` outright,
 * which is a paste from an email client and not a typo worth refusing.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Must be a valid email address.' }).max(254));

/**
 * Minimum length only, deliberately.
 *
 * Composition rules (an uppercase, a digit, a symbol) push people toward
 * `Password1!` and are worse than length. Breach-list checking belongs in
 * W3-01 where the network is available; this is the floor.
 */
export const passwordSchema = z
  .string()
  .min(12, { error: 'Must be at least 12 characters.' })
  .max(200, { error: 'Must be at most 200 characters.' });

/** Free text that a person typed and someone else will read. */
export const shortTextSchema = z.string().trim().min(1).max(200);
export const longTextSchema = z.string().trim().min(1).max(4000);

/**
 * An instant, accepted as an ISO 8601 string and produced as a `Date`.
 *
 * JSON has no date type, so the wire format is a string and the parsed value is
 * a `Date` — which means every handler downstream is working with a real
 * instant rather than deciding for itself how to read one.
 */
export const instantSchema = z.iso
  .datetime({ offset: true, error: 'Must be an ISO 8601 instant.' })
  .transform((value) => new Date(value));

/** An IANA timezone, validated by whether the runtime knows it. */
export const timeZoneSchema = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'Must be a known IANA timezone, e.g. Europe/London.' },
);

/** Weightages are `Decimal(5, 2)` in the database. */
export const weightageSchema = z
  .number({ error: 'Must be a number.' })
  .min(0, { error: 'Cannot be negative.' })
  .max(100, { error: 'Cannot exceed 100.' })
  // `Number.isInteger(Math.round(x))` is always true — the first version of
  // this check tested nothing. Compare the scaled value against its rounding
  // instead, with a tolerance for the fact that 33.33 * 100 is 3332.9999...
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    error: 'Cannot have more than two decimal places.',
  });

export const paginationSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.int().min(1).max(100).default(25),
});

/** The envelope every list endpoint returns. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/**
 * The shape of every failure the API returns.
 *
 * `fields` carries the per-field messages a form needs — the prototype returned
 * bare strings, so a returned goal sheet could not say which goal was wrong
 * (PRD US-305).
 */
export const apiErrorSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
});

export type Role = z.infer<typeof roleSchema>;
export type Uom = z.infer<typeof uomSchema>;
export type GoalDirection = z.infer<typeof goalDirectionSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type CycleStatus = z.infer<typeof cycleStatusSchema>;
export type PhaseKey = z.infer<typeof phaseKeySchema>;
export type ThrustArea = z.infer<typeof thrustAreaSchema>;
export type SheetStatus = z.infer<typeof sheetStatusSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;
export type RevisionReason = z.infer<typeof revisionReasonSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;
export type EscalationRule = z.infer<typeof escalationRuleSchema>;
export type EscalationTier = z.infer<typeof escalationTierSchema>;
export type EscalationStatus = z.infer<typeof escalationStatusSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
