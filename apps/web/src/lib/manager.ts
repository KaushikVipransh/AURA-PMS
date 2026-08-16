/**
 * Queries and mutations for the manager journey (W6-09, W6-10, W6-11).
 *
 * The queue is a read whose contents are a permission decision — the server
 * decides, per row, what the caller may do, and `actions` comes back with the
 * row. Nothing here re-derives that from the user's roles: a page that worked
 * out its own buttons would eventually offer one the API refuses, which is a
 * dead end for the person clicking it and invisible in review.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';
import { appraisalKey, type Goal, type Sheet } from './sheets.js';

export type QueueAction = 'APPROVE' | 'RETURN' | 'RATE';

export type QueueItem = {
  readonly sheetId: string;
  readonly userId: string;
  readonly userName: string;
  readonly status: 'DRAFT' | 'PENDING' | 'RETURNED' | 'APPROVED';
  readonly submittedAt: string | null;
  readonly goalCount: number;
  readonly score: number;
  readonly selfAppraisalSubmitted: boolean;
  readonly rated: boolean;
  readonly actions: readonly QueueAction[];
  readonly dueAt: string | null;
  readonly daysOverdue: number;
};

export type QueueCounts = {
  readonly total: number;
  readonly awaitingApproval: number;
  readonly awaitingRating: number;
  readonly overdue: number;
};

export type QueueResponse = {
  readonly cycleId: string;
  readonly items: readonly QueueItem[];
  readonly counts: QueueCounts;
};

export const queueKey = (cycleId: string) => ['queue', cycleId] as const;
export const reviewKey = (sheetId: string) => ['review', sheetId] as const;

export function useQueue(cycleId: string | null) {
  return useQuery({
    queryKey: queueKey(cycleId ?? ''),
    queryFn: () => api.get<QueueResponse>('/queue', { cycleId: String(cycleId) }),
    enabled: cycleId !== null,
  });
}

export type CheckInChange = {
  readonly goalId: string;
  readonly title: string;
  readonly fromActual: string | null;
  readonly toActual: string | null;
  readonly fromStatus: string;
  readonly toStatus: string;
};

export type CheckInEvent = {
  readonly at: string;
  readonly actorId: string;
  readonly changes: readonly CheckInChange[];
};

export type ReviewResponse = {
  readonly sheet: Sheet & { readonly goals: readonly Goal[] };
  readonly owner: { readonly id: string; readonly name: string; readonly email: string };
  readonly score: { readonly score: number; readonly percent: number };
  /** Reconstructed by the server from the audit trail, not a second table. */
  readonly checkIns: readonly CheckInEvent[];
};

export function useReview(sheetId: string | null) {
  return useQuery({
    queryKey: reviewKey(sheetId ?? ''),
    queryFn: () => api.get<ReviewResponse>(`/sheets/${String(sheetId)}/review`),
    enabled: sheetId !== null,
    retry: false,
  });
}

/**
 * Everything a decision on one sheet has to invalidate.
 *
 * Named once because the three mutations below all move the same sheet between
 * the same two views, and a mutation that refreshed the review but not the
 * queue would leave an approved sheet sitting in the queue until a reload —
 * which reads as "the button did nothing".
 */
function useSheetDecision(cycleId: string, sheetId: string) {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: queueKey(cycleId) });
    void queryClient.invalidateQueries({ queryKey: reviewKey(sheetId) });
    void queryClient.invalidateQueries({ queryKey: appraisalKey(sheetId) });
  };
}

export function useApproveSheet(cycleId: string, sheetId: string) {
  const settled = useSheetDecision(cycleId, sheetId);

  return useMutation({
    mutationFn: (note?: string) =>
      api.post(`/sheets/${sheetId}/approve`, note === undefined ? {} : { note }),
    onSuccess: settled,
  });
}

export function useReturnSheet(cycleId: string, sheetId: string) {
  const settled = useSheetDecision(cycleId, sheetId);

  return useMutation({
    mutationFn: (input: { reason: string; goalIds: readonly string[] }) =>
      api.post(`/sheets/${sheetId}/return`, input),
    onSuccess: settled,
  });
}

export type Adjustment = { readonly goalId: string; readonly weightage: number };

export function useAdjustWeightages(cycleId: string, sheetId: string) {
  const settled = useSheetDecision(cycleId, sheetId);

  return useMutation({
    mutationFn: (input: { adjustments: readonly Adjustment[]; note: string }) =>
      api.post(`/sheets/${sheetId}/adjust`, input),
    onSuccess: settled,
  });
}

export type ManagerRatingDraft = {
  readonly ratings: readonly { goalId: string; rating: number; commentary: string }[];
  readonly overallRating: number;
  readonly justification: string;
};

export function useSubmitRating(cycleId: string, sheetId: string) {
  const settled = useSheetDecision(cycleId, sheetId);

  return useMutation({
    mutationFn: (draft: ManagerRatingDraft) => api.post(`/appraisals/${sheetId}/rating`, draft),
    onSuccess: settled,
  });
}

/**
 * Approve several sheets, reporting on each one separately.
 *
 * **Sequential, and each result is its own.** There is no bulk endpoint, and
 * that is deliberate (see `routes/queue.ts`): approving six sheets is six
 * approvals, each snapshotting its own sheet and notifying its own employee,
 * and any one of them can legitimately fail — withdrawn, already approved by a
 * colleague, no longer pending. `Promise.all` would reject on the first of
 * those and lose the outcome of the rest; this returns one row per sheet so the
 * page can say which four worked and why the other two did not.
 */
export async function approveEach(
  sheetIds: readonly string[],
): Promise<{ sheetId: string; ok: boolean; message?: string }[]> {
  const results: { sheetId: string; ok: boolean; message?: string }[] = [];

  for (const sheetId of sheetIds) {
    try {
      await api.post(`/sheets/${sheetId}/approve`, {});
      results.push({ sheetId, ok: true });
    } catch (error) {
      results.push({
        sheetId,
        ok: false,
        message: error instanceof Error ? error.message : 'Approval failed.',
      });
    }
  }

  return results;
}
