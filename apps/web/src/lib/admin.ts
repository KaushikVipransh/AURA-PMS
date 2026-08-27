/**
 * Queries and mutations for administration (W6-12, W6-13).
 *
 * The cycle mutations invalidate `cyclesKey` rather than a key of their own,
 * because every page in the app reads the cycle list to work out what it is
 * looking at — a new cycle that only refreshed the admin screen would leave
 * the goal builder insisting there is no open cycle.
 */

import type { PhaseKey, Role, UserStatus } from '@aura/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api.js';
import { cyclesKey, type Cycle } from './sheets.js';

/* ------------------------------------------------------------------ *
 * Cycles (US-201, US-203, US-204)
 * ------------------------------------------------------------------ */

export type PhaseInput = {
  readonly key: PhaseKey;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
};

export type RatingScaleInput = {
  readonly min: number;
  readonly max: number;
  readonly labels: Readonly<Record<string, string>>;
};

export type EscalationRulesInput = {
  readonly manager: number;
  readonly skipLevelHr: number;
  readonly rules: readonly string[];
};

export type CreateCycleInput = {
  readonly name: string;
  readonly fiscalYear: number;
  readonly timeZone: string;
  readonly phases: readonly PhaseInput[];
  readonly ratingScale: RatingScaleInput;
  readonly escalationRules: EscalationRulesInput;
  readonly selfAppraisalDueAt?: string;
};

export function useCreateCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCycleInput) => api.post<{ cycle: Cycle }>('/cycles', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cyclesKey }),
  });
}

export function useActivateCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (cycleId: string) =>
      api.post<{ cycle: Cycle }>(`/cycles/${cycleId}/activate`, { confirm: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cyclesKey }),
  });
}

/* ------------------------------------------------------------------ *
 * Users (US-101, US-205)
 * ------------------------------------------------------------------ */

export type OrgUser = {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly Role[];
  readonly status: UserStatus;
  readonly managerId: string | null;
  readonly teamId: string | null;
  readonly timeZone: string;
};

export const usersKey = (search: string) => ['users', search] as const;

export function useUsers(search: string) {
  return useQuery({
    queryKey: usersKey(search),
    queryFn: () =>
      api.get<{ items: readonly OrgUser[]; nextCursor: string | null }>('/users', {
        limit: 100,
        ...(search === '' ? {} : { search }),
      }),
  });
}

export type InviteInput = {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly managerId: string | null;
};

/** Both mutations below invalidate every user list, whatever it was searching. */
function useUserListRefresh() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };
}

export function useInviteUser() {
  const refresh = useUserListRefresh();

  return useMutation({
    mutationFn: (input: InviteInput) => api.post<{ user: OrgUser }>('/users/invite', input),
    onSuccess: refresh,
  });
}

export function useDeactivateUser() {
  const refresh = useUserListRefresh();

  return useMutation({
    mutationFn: (userId: string) => api.post<{ user: OrgUser }>(`/users/${userId}/deactivate`),
    onSuccess: refresh,
  });
}

export type ImportRow = {
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly managerEmail: string | null;
  readonly teamName: string | null;
};

export type ImportResult = {
  readonly dryRun: boolean;
  readonly created: number;
  readonly skipped: number;
  readonly errors: readonly { row: number; email: string; message: string }[];
};

/**
 * Preview or commit, decided by one flag on one request.
 *
 * Not two hooks. A preview computed by one call and a commit performed by
 * another is a preview that can be wrong, and the only time anybody finds out
 * is after they trusted it (US-205).
 */
export function useImportUsers() {
  const refresh = useUserListRefresh();

  return useMutation({
    mutationFn: ({ rows, dryRun }: { rows: readonly ImportRow[]; dryRun: boolean }) =>
      api.post<ImportResult>('/users/import', { rows, dryRun }),
    onSuccess: (result) => {
      if (!result.dryRun) {
        refresh();
      }
    },
  });
}
