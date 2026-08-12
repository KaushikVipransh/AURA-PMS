/**
 * User and org-chart contracts (PRD E1, US-205).
 */

import { z } from 'zod';

import {
  emailSchema,
  idSchema,
  paginated,
  paginationSchema,
  roleSchema,
  shortTextSchema,
  timeZoneSchema,
  userStatusSchema,
} from './common.js';

export const inviteUserRequestSchema = z.object({
  name: shortTextSchema,
  email: emailSchema,
  role: roleSchema,
  /** Null for the top of the chain. Everyone else reports to someone. */
  managerId: idSchema.nullable().default(null),
  teamId: idSchema.nullable().default(null),
});

export const updateUserRequestSchema = z
  .object({
    name: shortTextSchema.optional(),
    role: roleSchema.optional(),
    managerId: idSchema.nullable().optional(),
    teamId: idSchema.nullable().optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Provide at least one field to change.',
  });

/**
 * Deactivation, not deletion (PRD US-106).
 *
 * There is no delete endpoint in this contract. A departing employee's history
 * is what a disputed appraisal is settled from, and `AuditEvent.actor` is
 * `onDelete: Restrict` precisely so the row cannot be removed out from under it.
 */
export const deactivateUserRequestSchema = z.object({
  reason: shortTextSchema.optional(),
});

export const userSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  status: userStatusSchema,
  managerId: idSchema.nullable(),
  teamId: idSchema.nullable(),
  timeZone: z.string(),
});

export const listUsersQuerySchema = paginationSchema.extend({
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  managerId: idSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

export const listUsersResponseSchema = paginated(userSchema);

/**
 * One row of a CSV import (PRD US-205).
 *
 * Managers are referenced by email rather than id, because the person building
 * the spreadsheet does not have ids — and resolving them server-side means a
 * manager can appear in the same file as their reports, in any order.
 */
export const importUserRowSchema = z.object({
  name: shortTextSchema,
  email: emailSchema,
  role: roleSchema,
  managerEmail: emailSchema.nullable().default(null),
  teamName: shortTextSchema.nullable().default(null),
});

export const importUsersRequestSchema = z.object({
  rows: z.array(importUserRowSchema).min(1).max(2000),
  /** Validate and report without writing anything. */
  dryRun: z.boolean().default(false),
});

/**
 * Import reports every bad row rather than stopping at the first.
 *
 * Someone importing 300 people should get one list of problems, not 300 round
 * trips.
 */
export const importUsersResponseSchema = z.object({
  created: z.int().min(0),
  skipped: z.int().min(0),
  errors: z.array(
    z.object({
      row: z.int().min(1),
      email: z.string(),
      message: z.string(),
    }),
  ),
});

export type InviteUserRequest = z.infer<typeof inviteUserRequestSchema>;
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;
export type DeactivateUserRequest = z.infer<typeof deactivateUserRequestSchema>;
export type User = z.infer<typeof userSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;
export type ImportUserRow = z.infer<typeof importUserRowSchema>;
export type ImportUsersRequest = z.infer<typeof importUsersRequestSchema>;
export type ImportUsersResponse = z.infer<typeof importUsersResponseSchema>;
