/**
 * Reviewing one sheet, and adjusting it inline (PRD US-502, US-503, US-305) —
 * W6-10.
 *
 * **Three decisions on one screen, each with what it costs stated next to it.**
 * Approving locks the sheet: past that point only progress fields move, which
 * is US-502's whole point and is said on the button's own line rather than
 * discovered afterwards. Returning demands a reason, because a sheet sent back
 * with none tells the employee to change something and not what (US-305). And
 * adjusting a weightage notifies them, because a number they are measured on
 * moving quietly is not an adjustment, it is a surprise (US-503).
 *
 * The meter is the same `WeightageMeter` the employee's own form uses, so a
 * manager and an employee are told the same thing by the same code — the
 * prototype had three disagreeing weightage checks (F-10) and this is where a
 * fourth would have gone.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { WeightageMeter } from '../components/WeightageMeter.js';
import {
  useAdjustWeightages,
  useApproveSheet,
  useReturnSheet,
  useReview,
} from '../lib/manager.js';
import { activeCycle, useCycles } from '../lib/sheets.js';
import { useInitialisedFrom } from '../lib/useInitialisedFrom.js';

export function ReviewPage() {
  const { sheetId = '' } = useParams<{ sheetId: string }>();
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);
  const review = useReview(sheetId === '' ? null : sheetId);

  const approve = useApproveSheet(cycle?.id ?? '', sheetId);
  const returnSheet = useReturnSheet(cycle?.id ?? '', sheetId);
  const adjust = useAdjustWeightages(cycle?.id ?? '', sheetId);

  const [weightages, setWeightages] = useInitialisedFrom(
    review.data?.sheet.goals,
    (goals) => Object.fromEntries(goals.map((goal) => [goal.id, Number(goal.weightage)])),
    {},
  );

  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [flagged, setFlagged] = useState<readonly string[]>([]);

  if (review.isPending) {
    return (
      <p className="p-8 text-sm" role="status">
        Loading…
      </p>
    );
  }

  if (review.data === undefined) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="mt-3 text-sm text-slate-600">
          That sheet is not available to you. It may have been withdrawn, or it may belong to
          somebody outside your reporting line.
        </p>
        <Link to="/queue" className="mt-4 inline-block text-sm underline">
          Back to the queue
        </Link>
      </main>
    );
  }

  const { sheet, owner, score, checkIns } = review.data;
  const pending = sheet.status === 'PENDING';
  const changed = sheet.goals.filter(
    (goal) => (weightages[goal.id] ?? Number(goal.weightage)) !== Number(goal.weightage),
  );

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link to="/queue" className="text-sm underline">
        ← Queue
      </Link>

      <h1 className="mt-2 text-2xl font-semibold">{owner.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle?.name} · {sheet.status.toLowerCase()} · score {Math.round(score.score * 100)}%
      </p>

      {!pending && (
        <p role="status" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          This sheet is {sheet.status.toLowerCase()}, so it can no longer be approved, returned or
          adjusted.
        </p>
      )}

      <div className="mt-6">
        <WeightageMeter
          goals={sheet.goals.map((goal) => ({
            title: goal.title,
            weightage: weightages[goal.id] ?? Number(goal.weightage),
          }))}
        />
      </div>

      <ol className="mt-6 space-y-4">
        {sheet.goals.map((goal) => (
          <li key={goal.id} className="rounded border p-4">
            <h2 className="font-medium">{goal.title}</h2>

            <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-sm text-slate-600">
              <dt>Target</dt>
              <dt>Actual</dt>
              <dt>Status</dt>
              <dd>{goal.target}</dd>
              <dd>{goal.actualAchievement ?? '—'}</dd>
              <dd>{goal.status}</dd>
            </dl>

            <div className="mt-3 flex items-end gap-4">
              <div className="flex w-40 flex-col gap-1">
                <label htmlFor={`weightage-${goal.id}`} className="text-sm">
                  Weightage %
                </label>
                <input
                  id={`weightage-${goal.id}`}
                  type="number"
                  inputMode="decimal"
                  disabled={!pending}
                  value={weightages[goal.id] ?? Number(goal.weightage)}
                  onChange={(event) => {
                    setWeightages((all) => ({ ...all, [goal.id]: Number(event.target.value) }));
                  }}
                  className="rounded border px-3 py-2"
                />
              </div>

              {pending && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={flagged.includes(goal.id)}
                    onChange={(event) => {
                      setFlagged((current) =>
                        event.target.checked
                          ? [...current, goal.id]
                          : current.filter((id) => id !== goal.id),
                      );
                    }}
                  />
                  Flag for rework
                </label>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* US-702 asks for this beside the rating; it belongs here too, because a
          manager approving mid-cycle is looking at the same actuals. */}
      <section aria-labelledby="checkins-heading" className="mt-8">
        <h2 id="checkins-heading" className="text-sm font-medium">
          Check-in history
        </h2>
        {checkIns.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No progress recorded yet.</p>
        ) : (
          <ol className="mt-2 space-y-2 text-sm" data-testid="check-in-history">
            {checkIns.map((event) => (
              <li key={event.at} className="rounded border p-3">
                <p className="text-slate-600">{new Date(event.at).toLocaleDateString()}</p>
                <ul className="mt-1 space-y-1">
                  {event.changes.map((change) => (
                    <li key={change.goalId}>
                      {change.title}: {change.fromActual ?? '—'} → {change.toActual ?? '—'} (
                      {change.toStatus})
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      {pending && (
        <>
          <section aria-labelledby="adjust-heading" className="mt-8 rounded border p-4">
            <h2 id="adjust-heading" className="text-sm font-medium">
              Adjust weightages
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {owner.name} is notified with a note explaining what changed and why.
            </p>

            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor="adjust-note" className="text-sm">
                Note
              </label>
              <textarea
                id="adjust-note"
                rows={2}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                className="rounded border px-3 py-2"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                adjust.mutate(
                  {
                    adjustments: changed.map((goal) => ({
                      goalId: goal.id,
                      weightage: weightages[goal.id] ?? Number(goal.weightage),
                    })),
                    note,
                  },
                  {
                    onSuccess: () => {
                      toast.success('Weightages adjusted and the employee notified.');
                      setNote('');
                    },
                  },
                );
              }}
              disabled={changed.length === 0 || note.trim() === '' || adjust.isPending}
              className="mt-3 rounded border px-4 py-2 text-sm disabled:opacity-50"
            >
              Save {changed.length} adjustment{changed.length === 1 ? '' : 's'}
            </button>
          </section>

          <section aria-labelledby="return-heading" className="mt-6 rounded border p-4">
            <h2 id="return-heading" className="text-sm font-medium">
              Return for rework
            </h2>

            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor="return-reason" className="text-sm">
                What should change?
              </label>
              <textarea
                id="return-reason"
                rows={3}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
                className="rounded border px-3 py-2"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                returnSheet.mutate(
                  { reason, goalIds: flagged },
                  {
                    onSuccess: () => {
                      toast.success('Returned for rework.');
                      setReason('');
                    },
                  },
                );
              }}
              disabled={reason.trim() === '' || returnSheet.isPending}
              className="mt-3 rounded border px-4 py-2 text-sm disabled:opacity-50"
            >
              Return
            </button>
          </section>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                approve.mutate(undefined, {
                  onSuccess: () => {
                    toast.success('Approved and locked.');
                  },
                });
              }}
              disabled={approve.isPending}
              className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Approve and lock
            </button>
            <p className="mt-2 text-xs text-slate-600">
              Approving locks the goals. After this only progress can be recorded — targets and
              weightages are fixed for the cycle.
            </p>
          </div>
        </>
      )}
    </main>
  );
}
