/**
 * The approval queue (PRD US-501) — W6-09.
 *
 * **One list, and the server decides what is in it.** The prototype's manager
 * workspace fetched every sheet in the database and filtered them in the
 * browser by comparing a lowercased display name against the signed-in user's
 * (PLAN.md F-05), which meant two people called "Priya Sharma" saw each other's
 * work and a rename broke the filter silently. Here the queue is a walk of the
 * reporting tree in Postgres, and each row arrives carrying the actions W2-06
 * permits — so a button that appears is a button that works.
 *
 * Overdue rows are marked in three ways at once (colour, a text badge, and
 * position at the top of the list) because colour alone is not a signal
 * everybody receives — the same reason W6-19's pass exists.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { approveEach, useQueue } from '../lib/manager.js';
import {
  QUEUE_FILTERS,
  applyFilter,
  applySort,
  waitingOn,
  type QueueFilter,
  type QueueSort,
} from '../lib/queue-view.js';
import { activeCycle, useCycles } from '../lib/sheets.js';

export function QueuePage() {
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);
  const queue = useQueue(cycle?.id ?? null);

  const [filter, setFilter] = useState<QueueFilter>('AWAITING');
  const [sort, setSort] = useState<QueueSort>('URGENCY');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [approving, setApproving] = useState(false);

  if (cycles.isPending || queue.isPending) {
    return (
      <p className="p-8 text-sm" role="status">
        Loading…
      </p>
    );
  }

  const items = queue.data?.items ?? [];
  const counts = queue.data?.counts;
  const shown = applySort(applyFilter(items, filter), sort);
  const approvable = shown.filter((item) => item.actions.includes('APPROVE'));
  const chosen = selected.filter((id) => approvable.some((item) => item.sheetId === id));

  async function approveSelected(): Promise<void> {
    setApproving(true);

    /* One request per sheet, and one outcome per sheet. See `approveEach`:
       a batch that fails halfway must still say which half succeeded. */
    const results = await approveEach(chosen);
    const failed = results.filter((result) => !result.ok);

    setApproving(false);
    setSelected([]);
    await queue.refetch();

    if (failed.length === 0) {
      toast.success(`Approved ${String(results.length)} sheets.`);
      return;
    }

    toast.error(
      `Approved ${String(results.length - failed.length)} of ${String(results.length)}. ` +
        `${String(failed.length)} could not be approved: ${failed[0]?.message ?? ''}`,
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Approval queue</h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle?.name ?? 'No open cycle'} · everything in your reporting line, most urgent first.
      </p>

      {counts !== undefined && (
        <ul className="mt-4 flex flex-wrap gap-3 text-sm" data-testid="queue-counts">
          <li className="rounded border px-3 py-1">
            <strong>{counts.awaitingApproval}</strong> to approve
          </li>
          <li className="rounded border px-3 py-1">
            <strong>{counts.awaitingRating}</strong> to rate
          </li>
          <li
            className={
              counts.overdue > 0
                ? 'rounded border border-red-300 bg-red-50 px-3 py-1 text-red-800'
                : 'rounded border px-3 py-1'
            }
          >
            <strong>{counts.overdue}</strong> overdue
          </li>
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="queue-filter" className="text-sm">
            Show
          </label>
          <select
            id="queue-filter"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as QueueFilter);
            }}
            className="rounded border px-3 py-2 text-sm"
          >
            {QUEUE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="queue-sort" className="text-sm">
            Sort by
          </label>
          <select
            id="queue-sort"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as QueueSort);
            }}
            className="rounded border px-3 py-2 text-sm"
          >
            <option value="URGENCY">Urgency</option>
            <option value="NAME">Name</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            void approveSelected();
          }}
          disabled={chosen.length === 0 || approving}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {approving ? 'Approving…' : `Approve ${String(chosen.length)} selected`}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="mt-8 text-sm text-slate-600">
          Nothing here. {filter === 'AWAITING' ? 'Nothing is waiting on you right now.' : ''}
        </p>
      ) : (
        <ul className="mt-6 space-y-3" data-testid="queue-list">
          {shown.map((item) => (
            <li
              key={item.sheetId}
              className={
                item.daysOverdue > 0
                  ? 'rounded border border-red-300 bg-red-50 p-4'
                  : 'rounded border p-4'
              }
            >
              <div className="flex items-start gap-3">
                {item.actions.includes('APPROVE') && (
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={`Select ${item.userName}`}
                    checked={selected.includes(item.sheetId)}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, item.sheetId]
                          : current.filter((id) => id !== item.sheetId),
                      );
                    }}
                  />
                )}

                <div className="flex-1">
                  <h2 className="font-medium">
                    <Link to={`/queue/${item.sheetId}`} className="underline">
                      {item.userName}
                    </Link>
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {waitingOn(item)} · {item.goalCount} goals · score{' '}
                    {Math.round(item.score * 100)}%
                  </p>

                  {item.daysOverdue > 0 && (
                    /* Text as well as colour. "Overdue by 3 days" is legible to
                       a screen reader and to anyone who cannot see the red. */
                    <p className="mt-1 text-sm font-medium text-red-800">
                      Overdue by {item.daysOverdue}{' '}
                      {item.daysOverdue === 1 ? 'day' : 'days'}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  {item.actions.includes('APPROVE') && (
                    <Link
                      to={`/queue/${item.sheetId}`}
                      className="rounded border px-3 py-1 text-sm"
                    >
                      Review
                    </Link>
                  )}
                  {item.actions.includes('RATE') && (
                    <Link
                      to={`/queue/${item.sheetId}/rating`}
                      className="rounded border px-3 py-1 text-sm"
                    >
                      Rate
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
