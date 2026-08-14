/**
 * Escalation, audit, notification and export contracts (PRD E9, E10, E11, E12).
 */

import { z } from 'zod';

import {
  escalationRuleSchema,
  escalationStatusSchema,
  escalationTierSchema,
  idSchema,
  instantSchema,
  longTextSchema,
  notificationChannelSchema,
  notificationStatusSchema,
  paginated,
  paginationSchema,
} from './common.js';

export const escalationSchema = z.object({
  id: idSchema,
  cycleId: idSchema,
  subjectUserId: idSchema,
  rule: escalationRuleSchema,
  tier: escalationTierSchema,
  status: escalationStatusSchema,
  dueAt: z.iso.datetime({ offset: true }),
  /** Real elapsed days, with no floor. The prototype used max(elapsed, 4). */
  daysOverdue: z.int().min(0),
  /** One entry per notification actually sent, not per one intended. */
  notifiedAt: z.array(z.iso.datetime({ offset: true })),
  resolvedAt: z.iso.datetime({ offset: true }).nullable(),
  resolutionNote: z.string().nullable(),
});

export const listEscalationsQuerySchema = paginationSchema.extend({
  cycleId: idSchema,
  status: escalationStatusSchema.optional(),
  tier: escalationTierSchema.optional(),
  rule: escalationRuleSchema.optional(),
  subjectUserId: idSchema.optional(),
});

export const listEscalationsResponseSchema = paginated(escalationSchema);

/** US-904 — resolving requires a note, so the trail says why it stopped. */
export const resolveEscalationRequestSchema = z.object({
  note: longTextSchema,
});

/** US-903 — the live compliance dashboard for a cycle. */
export const complianceSummarySchema = z.object({
  cycleId: idSchema,
  totalUsers: z.int().min(0),
  sheetsSubmitted: z.int().min(0),
  sheetsApproved: z.int().min(0),
  selfAppraisalsComplete: z.int().min(0),
  managerRatingsComplete: z.int().min(0),
  openEscalations: z.int().min(0),
  byTier: z.record(escalationTierSchema, z.int().min(0)),
});

export const auditEventSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  actorId: idSchema,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  changedFields: z.array(z.string()),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

/** US-1102 — searching the trail. */
export const listAuditQuerySchema = paginationSchema.extend({
  actorId: idSchema.optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(50).optional(),
  action: z.string().max(100).optional(),
  from: instantSchema.optional(),
  to: instantSchema.optional(),
});

export const listAuditResponseSchema = paginated(auditEventSchema);

export const notificationSchema = z.object({
  id: idSchema,
  userId: idSchema,
  channel: notificationChannelSchema,
  status: notificationStatusSchema,
  subject: z.string(),
  body: z.string(),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const listNotificationsQuerySchema = paginationSchema.extend({
  unreadOnly: z.boolean().default(false),
});

export const listNotificationsResponseSchema = paginated(notificationSchema);

export const markNotificationsReadRequestSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
});

/**
 * US-1001 — the analytics query.
 *
 * Filters are all optional except the cycle. Analytics across every cycle at
 * once is a question nobody asks and a table scan everybody pays for.
 */
export const analyticsQuerySchema = z.object({
  cycleId: idSchema,
  teamId: idSchema.optional(),
  managerId: idSchema.optional(),
});

/** One row of a `GROUP BY`: what was counted, and how many. */
export const analyticsBucketSchema = z.object({
  bucket: z.string(),
  count: z.int().min(0),
});

export const analyticsResponseSchema = z.object({
  cycleId: idSchema,
  totalSheets: z.int().min(0),
  totalGoals: z.int().min(0),
  byThrustArea: z.array(analyticsBucketSchema),
  byUom: z.array(analyticsBucketSchema),
  byGoalStatus: z.array(analyticsBucketSchema),
  bySheetStatus: z.array(analyticsBucketSchema),
});

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export const exportFormatSchema = z.enum(EXPORT_FORMATS);

/**
 * US-1002 — an export request.
 *
 * The column list is part of the request rather than implied, so adding a
 * field to a model never silently widens what leaves the system.
 */
export const exportRequestSchema = z.object({
  cycleId: idSchema,
  format: exportFormatSchema.default('csv'),
  columns: z.array(z.string().max(50)).min(1).max(50),
  includeRatings: z.boolean().default(false),
});

export type Escalation = z.infer<typeof escalationSchema>;
export type ListEscalationsQuery = z.infer<typeof listEscalationsQuerySchema>;
export type ListEscalationsResponse = z.infer<typeof listEscalationsResponseSchema>;
export type ResolveEscalationRequest = z.infer<typeof resolveEscalationRequestSchema>;
export type ComplianceSummary = z.infer<typeof complianceSummarySchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
export type ListAuditResponse = z.infer<typeof listAuditResponseSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type ListNotificationsResponse = z.infer<typeof listNotificationsResponseSchema>;
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadRequestSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsBucket = z.infer<typeof analyticsBucketSchema>;
export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>;
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type ExportRequest = z.infer<typeof exportRequestSchema>;
