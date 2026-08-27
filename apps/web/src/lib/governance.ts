/**
 * Queries and mutations for the governance views (W6-14, W6-15, W6-16).
 *
 * Every number here is counted by Postgres and arrives finished. Nothing in
 * this file sums, averages or bins anything — F-13 was the prototype pulling
 * every sheet into Node and counting with `forEach`, and moving that loop into
 * the browser would be the same mistake at a different altitude, with the
 * added twist that each viewer would compute it again.
 */

import type { EscalationRule, EscalationTier } from '@aura/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';

/* ------------------------------------------------------------------ *
 * Analytics (US-1001)
 * ------------------------------------------------------------------ */

export type AnalyticsBucket = { readonly bucket: string; readonly count: number };

export type AnalyticsResponse = {
  readonly cycleId: string;
  readonly totalSheets: number;
  readonly totalGoals: number;
  readonly byThrustArea: readonly AnalyticsBucket[];
  readonly byUom: readonly AnalyticsBucket[];
  readonly byGoalStatus: readonly AnalyticsBucket[];
  readonly bySheetStatus: readonly AnalyticsBucket[];
};

export type AnalyticsFilters = {
  readonly teamId?: string | undefined;
  readonly managerId?: string | undefined;
};

export const analyticsKey = (cycleId: string, filters: AnalyticsFilters) =>
  ['analytics', cycleId, filters.teamId ?? '', filters.managerId ?? ''] as const;

export function useAnalytics(cycleId: string | null, filters: AnalyticsFilters = {}) {
  return useQuery({
    queryKey: analyticsKey(cycleId ?? '', filters),
    queryFn: () =>
      api.get<AnalyticsResponse>('/analytics', {
        cycleId: String(cycleId),
        ...(filters.teamId === undefined ? {} : { teamId: filters.teamId }),
        ...(filters.managerId === undefined ? {} : { managerId: filters.managerId }),
      }),
    enabled: cycleId !== null,
  });
}

/* ------------------------------------------------------------------ *
 * Calibration (US-801, US-802, US-803)
 * ------------------------------------------------------------------ */

export type CalibrationResponse = {
  readonly cycleId: string;
  readonly scale: { readonly min: number; readonly max: number };
  readonly distribution: readonly { readonly rating: number; readonly count: number }[];
  readonly byManager: readonly {
    readonly managerId: string | null;
    readonly managerName: string;
    readonly count: number;
    readonly mean: number;
    /** Computed server-side against the org mean; see `OUTLIER_FRACTION`. */
    readonly outlier: boolean;
  }[];
  readonly orgMean: number;
  readonly divergences: readonly {
    readonly appraisalId: string;
    readonly sheetId: string;
    readonly userId: string;
    readonly userName: string;
    readonly computedScore: number;
    readonly computedOnScale: number;
    readonly managerRating: number;
    readonly divergence: number;
  }[];
  readonly total: number;
};

export const calibrationKey = (cycleId: string) => ['calibration', cycleId] as const;

export function useCalibration(cycleId: string | null) {
  return useQuery({
    queryKey: calibrationKey(cycleId ?? ''),
    queryFn: () => api.get<CalibrationResponse>('/calibration', { cycleId: String(cycleId) }),
    enabled: cycleId !== null,
  });
}

export function useAdjustRating(cycleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { appraisalId: string; finalRating: number; reason: string }) =>
      api.post('/calibration/adjust', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: calibrationKey(cycleId) }),
  });
}

export type ReleaseResult = { readonly released: number };

export function useReleaseResults(cycleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<ReleaseResult>('/calibration/release', { cycleId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: calibrationKey(cycleId) }),
  });
}

/* ------------------------------------------------------------------ *
 * Compliance and escalations (US-903, US-904)
 * ------------------------------------------------------------------ */

export type ComplianceResponse = {
  readonly cycleId: string;
  readonly totalUsers: number;
  readonly sheetsSubmitted: number;
  readonly sheetsApproved: number;
  readonly selfAppraisalsComplete: number;
  readonly managerRatingsComplete: number;
  readonly openEscalations: number;
  readonly byTier: Readonly<Record<string, number>>;
};

export const complianceKey = (cycleId: string) => ['compliance', cycleId] as const;

export function useCompliance(cycleId: string | null) {
  return useQuery({
    queryKey: complianceKey(cycleId ?? ''),
    queryFn: () => api.get<ComplianceResponse>('/compliance', { cycleId: String(cycleId) }),
    enabled: cycleId !== null,
  });
}

export type Escalation = {
  readonly id: string;
  readonly cycleId: string;
  readonly subjectUserId: string;
  readonly subjectName: string;
  readonly rule: EscalationRule;
  readonly tier: EscalationTier;
  readonly status: 'ACTIVE' | 'RESOLVED';
  readonly dueAt: string;
  readonly notifiedAt: string | null;
  readonly resolvedAt: string | null;
  readonly resolutionNote: string | null;
  /** Real elapsed days in the subject's own zone, never floored (F-08). */
  readonly daysOverdue: number;
};

export type EscalationFilters = {
  readonly status?: 'ACTIVE' | 'RESOLVED' | undefined;
  readonly tier?: EscalationTier | undefined;
};

export const escalationsKey = (cycleId: string, filters: EscalationFilters) =>
  ['escalations', cycleId, filters.status ?? '', filters.tier ?? ''] as const;

export function useEscalations(cycleId: string | null, filters: EscalationFilters = {}) {
  return useQuery({
    queryKey: escalationsKey(cycleId ?? '', filters),
    queryFn: () =>
      api.get<{ items: readonly Escalation[]; nextCursor: string | null }>('/escalations', {
        cycleId: String(cycleId),
        limit: 100,
        ...(filters.status === undefined ? {} : { status: filters.status }),
        ...(filters.tier === undefined ? {} : { tier: filters.tier }),
      }),
    enabled: cycleId !== null,
  });
}

export function useResolveEscalation(cycleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post(`/escalations/${id}/resolve`, { note }),
    onSuccess: () => {
      // Both: resolving one removes it from the board *and* changes the open
      // count on the dashboard above it.
      void queryClient.invalidateQueries({ queryKey: ['escalations'] });
      void queryClient.invalidateQueries({ queryKey: complianceKey(cycleId) });
    },
  });
}
