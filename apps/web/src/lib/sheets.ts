/**
 * Queries and mutations for goal sheets (W6-06, W6-07, W6-08).
 *
 * The keys are declared here rather than inline at each call, so a mutation
 * that must invalidate a list cannot invalidate a key that no longer matches
 * the one the list registered under — a bug that presents as "the page did not
 * update" and is invisible in review.
 */

import type { GoalDirection, GoalStatus, ThrustArea, Uom } from '@aura/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';

export type Cycle = {
  readonly id: string;
  readonly name: string;
  readonly fiscalYear: number;
  readonly status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  readonly phases: readonly {
    readonly key: string;
    readonly label: string;
    readonly startsAt: string;
    readonly endsAt: string;
  }[];
};

export type Goal = {
  readonly id: string;
  readonly thrustArea: ThrustArea;
  readonly title: string;
  readonly uom: Uom;
  readonly direction: GoalDirection;
  readonly target: string;
  readonly weightage: string | number;
  readonly actualAchievement: string | null;
  readonly status: GoalStatus;
};

export type Sheet = {
  readonly id: string;
  readonly userId: string;
  readonly cycleId: string;
  readonly status: 'DRAFT' | 'PENDING' | 'RETURNED' | 'APPROVED';
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly goals: readonly Goal[];
};

export type SheetResponse = {
  readonly sheet: Sheet;
  /** Computed by the W2-01 engine on the server, never in the browser (F-07). */
  readonly score: { readonly score: number; readonly percent: number };
};

export const cyclesKey = ['cycles'] as const;
export const sheetKey = (cycleId: string) => ['sheets', cycleId] as const;
export const appraisalKey = (sheetId: string) => ['appraisals', sheetId] as const;

export function useCycles() {
  return useQuery({
    queryKey: cyclesKey,
    queryFn: () => api.get<{ cycles: readonly Cycle[] }>('/cycles'),
  });
}

/** The active cycle, or the most recent one if none is active. */
export function activeCycle(cycles: readonly Cycle[] | undefined): Cycle | null {
  if (cycles === undefined || cycles.length === 0) {
    return null;
  }

  return cycles.find((cycle) => cycle.status === 'ACTIVE') ?? cycles[0] ?? null;
}

export function useSheet(cycleId: string | null) {
  return useQuery({
    queryKey: sheetKey(cycleId ?? ''),
    queryFn: () => api.get<SheetResponse>(`/sheets/${String(cycleId)}`),
    // Skipped until a cycle is known. Firing with an empty id would 404 and
    // put an error toast on a page that is merely still loading.
    enabled: cycleId !== null,
    /* A 404 is the honest answer for "you have not started a sheet yet", so it
       is handled by the caller rather than retried or reported. */
    retry: false,
  });
}

export type GoalDraft = {
  readonly thrustArea: ThrustArea;
  readonly title: string;
  readonly uom: Uom;
  readonly direction: GoalDirection;
  readonly target: string;
  readonly weightage: number;
};

export function useSaveDraft(cycleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (goals: readonly GoalDraft[]) =>
      api.put<{ sheet: Sheet }>(`/sheets/${cycleId}`, { goals }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sheetKey(cycleId) }),
  });
}

export function useSubmitSheet(cycleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sheetId: string) => api.post<{ sheet: Sheet }>(`/sheets/${sheetId}/submit`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sheetKey(cycleId) }),
  });
}

export type CheckInUpdate = {
  readonly goalId: string;
  readonly actualAchievement: string;
  readonly status: GoalStatus;
};

export function useCheckIn(cycleId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sheetId, updates }: { sheetId: string; updates: readonly CheckInUpdate[] }) =>
      api.post<{ sheet: Sheet }>(`/sheets/${sheetId}/check-in`, { updates }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sheetKey(cycleId) }),
  });
}

export type AppraisalGoal = {
  readonly id: string;
  readonly title: string;
  readonly target: string;
  readonly actualAchievement: string | null;
  readonly weightage: number;
  readonly computedScore: number;
  readonly selfNarrative: string | null;
  readonly managerRating: number | null;
  readonly managerNarrative: string | null;
};

export type AppraisalResponse = {
  readonly sheetId: string;
  readonly scale: { readonly min: number; readonly max: number };
  readonly computedScore: number;
  readonly computedOnScale: number;
  readonly appraisal: {
    readonly selfNarrative: string | null;
    readonly selfRating: number | null;
    readonly selfSubmittedAt: string | null;
    readonly managerRating: number | null;
    readonly finalRating: number | null;
    readonly releasedAt: string | null;
  } | null;
  readonly goals: readonly AppraisalGoal[];
};

export function useAppraisal(sheetId: string | null) {
  return useQuery({
    queryKey: appraisalKey(sheetId ?? ''),
    queryFn: () => api.get<AppraisalResponse>(`/appraisals/${String(sheetId)}`),
    enabled: sheetId !== null,
    retry: false,
  });
}

export type SelfAppraisalDraft = {
  readonly entries: readonly { goalId: string; commentary: string }[];
  readonly summary: string;
  readonly selfRating?: number;
};

export function useSaveSelfAppraisal(sheetId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ draft, submit }: { draft: SelfAppraisalDraft; submit: boolean }) =>
      submit
        ? api.post(`/appraisals/${sheetId}/self/submit`, draft)
        : api.put(`/appraisals/${sheetId}/self`, draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appraisalKey(sheetId) }),
  });
}
