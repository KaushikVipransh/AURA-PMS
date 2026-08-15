/**
 * Recording progress (PRD US-601) — W6-07.
 *
 * **Only two fields are editable, and that is visible rather than merely
 * true.** The prototype's check-in route trusted the client's entire payload
 * and wrote it over an approved sheet, so a "progress update" could silently
 * rewrite targets and weightages (PLAN.md F-04). The server whitelists two
 * columns and the contract has no room for the others; this form shows the
 * agreed figures as read-only text beside the inputs, so what is fixed and
 * what is not is apparent before anyone types.
 */

import { GOAL_STATUSES, GOAL_STATUS_LABELS } from '@aura/core';
import type { GoalStatus } from '@aura/contracts';

import { toast } from 'sonner';

import {
  activeCycle,
  useCheckIn,
  useCycles,
  useSheet,
  type CheckInUpdate,
  type Goal,
} from '../lib/sheets.js';
import { useInitialisedFrom } from '../lib/useInitialisedFrom.js';

export function CheckInPage() {
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);
  const sheet = useSheet(cycle?.id ?? null);
  const checkIn = useCheckIn(cycle?.id ?? '');

  const [updates, setUpdates] = useInitialisedFrom<readonly Goal[], Record<string, CheckInUpdate>>(
    sheet.data?.sheet.goals,
    (goals) =>
      Object.fromEntries(
        goals.map((goal) => [
          goal.id,
          {
            goalId: goal.id,
            actualAchievement: goal.actualAchievement ?? '',
            status: goal.status,
          },
        ]),
      ),
    {},
  );

  if (cycles.isPending || sheet.isPending) {
    return (
      <p className="p-8 text-sm" role="status">
        Loading…
      </p>
    );
  }

  const current = sheet.data?.sheet;

  if (current === undefined || current.status !== 'APPROVED') {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Check in</h1>
        <p className="mt-3 text-sm text-slate-600">
          Progress can only be recorded against an approved sheet. Yours is{' '}
          {current === undefined ? 'not started' : current.status.toLowerCase()}.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Check in</h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle?.name}. Your goals were agreed when this sheet was approved and cannot change here —
        only what you have achieved, and where each one stands.
      </p>

      <p className="mt-2 text-sm" data-testid="sheet-score">
        Current score: {Math.round((sheet.data?.score.score ?? 0) * 100)}%
      </p>

      <ol className="mt-6 space-y-4">
        {current.goals.map((goal) => (
          <li key={goal.id} className="rounded border p-4">
            <h2 className="font-medium">{goal.title}</h2>

            {/*
              * The agreed figures, as text. Read-only because they are, and
              * shown because a form that hid them would look like it could
              * change them.
              */}
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-600">
              <dt>Target</dt>
              <dd data-testid={`target-${goal.id}`}>{goal.target}</dd>
              <dt>Weightage</dt>
              <dd>{String(goal.weightage)}%</dd>
            </dl>

            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor={`actual-${goal.id}`} className="text-sm">
                Actual achievement
              </label>
              <input
                id={`actual-${goal.id}`}
                value={updates[goal.id]?.actualAchievement ?? ''}
                onChange={(event) => {
                  setUpdates((all) => ({
                    ...all,
                    [goal.id]: {
                      goalId: goal.id,
                      status: all[goal.id]?.status ?? goal.status,
                      actualAchievement: event.target.value,
                    },
                  }));
                }}
                className="rounded border px-3 py-2"
              />
            </div>

            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor={`status-${goal.id}`} className="text-sm">
                Status
              </label>
              <select
                id={`status-${goal.id}`}
                value={updates[goal.id]?.status ?? goal.status}
                onChange={(event) => {
                  setUpdates((all) => ({
                    ...all,
                    [goal.id]: {
                      goalId: goal.id,
                      actualAchievement: all[goal.id]?.actualAchievement ?? '',
                      status: event.target.value as GoalStatus,
                    },
                  }));
                }}
                className="rounded border px-3 py-2"
              >
                {GOAL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {GOAL_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => {
          checkIn.mutate(
            { sheetId: current.id, updates: Object.values(updates) },
            {
              onSuccess: () => {
                toast.success('Progress recorded.');
              },
            },
          );
        }}
        disabled={checkIn.isPending}
        className="mt-6 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {checkIn.isPending ? 'Saving…' : 'Record progress'}
      </button>
    </main>
  );
}
