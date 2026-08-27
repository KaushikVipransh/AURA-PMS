/**
 * The audit trail and the inbox (W6-17, W6-18).
 *
 * Both are append-only reads over records the system wrote about itself, which
 * is why neither has an edit mutation. The only write in this file marks a
 * notification read — and even that is about the reader, not about the event.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';

/* ------------------------------------------------------------------ *
 * The audit trail (US-1102, US-1103)
 * ------------------------------------------------------------------ */

export type AuditEvent = {
  readonly id: string;
  readonly orgId: string;
  readonly actorId: string;
  /** Dotted verb, e.g. `goalsheet.approve`. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  /** Derived by the server from the diff, so it cannot disagree with it. */
  readonly changedFields: readonly string[];
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: string;
};

export type AuditFilters = {
  readonly action?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly actorId?: string | undefined;
};

export const auditKey = (filters: AuditFilters) =>
  [
    'audit',
    filters.action ?? '',
    filters.entityType ?? '',
    filters.entityId ?? '',
    filters.actorId ?? '',
  ] as const;

export function useAuditTrail(filters: AuditFilters = {}) {
  return useQuery({
    queryKey: auditKey(filters),
    queryFn: () =>
      api.get<{ items: readonly AuditEvent[]; nextCursor: string | null }>('/audit', {
        limit: 50,
        ...(filters.action === undefined || filters.action === '' ? {} : { action: filters.action }),
        ...(filters.entityType === undefined || filters.entityType === ''
          ? {}
          : { entityType: filters.entityType }),
        ...(filters.entityId === undefined || filters.entityId === ''
          ? {}
          : { entityId: filters.entityId }),
        ...(filters.actorId === undefined || filters.actorId === ''
          ? {}
          : { actorId: filters.actorId }),
      }),
  });
}

export type SheetRevision = {
  readonly id: string;
  readonly revision: number;
  readonly reason: 'SUBMIT' | 'APPROVE' | 'ADJUST';
  readonly actorId: string;
  readonly createdAt: string;
  readonly snapshot: unknown;
};

export function useRevisions(sheetId: string | null) {
  return useQuery({
    queryKey: ['revisions', sheetId ?? ''] as const,
    queryFn: () =>
      api.get<{ revisions: readonly SheetRevision[] }>(`/sheets/${String(sheetId)}/revisions`),
    enabled: sheetId !== null && sheetId !== '',
    retry: false,
  });
}

/* ------------------------------------------------------------------ *
 * The inbox (US-1201)
 * ------------------------------------------------------------------ */

export type InboxItem = {
  readonly id: string;
  readonly type: string;
  readonly subject: string;
  readonly body: string;
  /** Where the action is. Rendered from the template, so it is decided once. */
  readonly link: string | null;
  readonly category: string;
  /** Compliance notices, which cannot be turned off, and say so (US-1202). */
  readonly mandatory: boolean;
  readonly readAt: string | null;
  readonly createdAt: string;
};

export type InboxResponse = {
  readonly unread: number;
  readonly items: readonly InboxItem[];
  readonly nextCursor: string | null;
};

export const inboxKey = (unreadOnly: boolean) => ['notifications', unreadOnly] as const;

export function useInbox(unreadOnly: boolean) {
  return useQuery({
    queryKey: inboxKey(unreadOnly),
    queryFn: () =>
      api.get<InboxResponse>('/notifications', { limit: 50, unreadOnly }),
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: readonly string[]) => api.post('/notifications/read', { ids }),
    // Every inbox view, whichever filter it holds — the badge on one is the
    // same number as the badge on the other.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
