/**
 * The calibration meeting, on one screen (PRD US-801, US-802, US-803) — W6-14.
 *
 * A calibration meeting is a room of people arguing about a distribution, so
 * the distribution, the per-manager split and the disagreements are all on one
 * page and come from one request. Three screens would mean three round trips
 * for one conversation, and the numbers could disagree between them.
 *
 * **Outliers are named, not coloured.** A manager whose mean sits far from the
 * organization's is marked with the word "Outlier" and the size of the gap, in
 * a table — because the reader's next action is to ask that person about it,
 * and "the reddish row" is not something you can put in a meeting invitation.
 * The server decides who is an outlier (`OUTLIER_FRACTION`, a fraction of the
 * scale's range rather than a fixed number of points) so the page and the API
 * cannot hold different opinions.
 *
 * **US-802's mandatory reason is enforced three times over**: the schema
 * requires it, the service refuses without it, and the button here stays
 * disabled until it is written. That is not redundancy — the first two protect
 * the record, and this one means somebody finds out before they have picked a
 * number and moved on.
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { DistributionChart } from '../components/DistributionChart.js';
import {
  useAdjustRating,
  useCalibration,
  useReleaseResults,
  type CalibrationResponse,
} from '../lib/governance.js';
import { activeCycle, useCycles } from '../lib/sheets.js';

type Adjustment = { readonly rating: string; readonly reason: string };

export function CalibrationPage() {
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);
  const calibration = useCalibration(cycle?.id ?? null);
  const adjust = useAdjustRating(cycle?.id ?? '');
  const release = useReleaseResults(cycle?.id ?? '');

  const [edits, setEdits] = useState<Record<string, Adjustment>>({});
  const [unreleased, setUnreleased] = useState<readonly string[]>([]);

  if (cycles.isPending || calibration.isPending) {
    return (
      <p className="p-8 text-sm" role="status">
        Loading…
      </p>
    );
  }

  const data = calibration.data;

  if (data === undefined || cycle === null) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <h1 className="text-2xl font-semibold">Calibration</h1>
        <p className="mt-3 text-sm text-slate-600">There is no cycle to calibrate yet.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Calibration</h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle.name} · {data.total} rated · organization mean{' '}
        <span className="tabular-nums">{data.orgMean}</span> on a {data.scale.min}–
        {data.scale.max} scale
      </p>

      <div className="mt-6">
        <DistributionChart
          title="Rating distribution"
          testId="rating-distribution"
          caption="Every point on the scale appears, including the ones nobody scored — a distribution with holes reads as missing data rather than as zero."
          slices={data.distribution.map((point) => ({
            label: String(point.rating),
            count: point.count,
          }))}
          reference={{ value: data.orgMean, label: `mean ${String(data.orgMean)}` }}
        />
      </div>

      <ManagerTable byManager={data.byManager} orgMean={data.orgMean} />

      <section aria-labelledby="divergence-heading" className="mt-8">
        <h2 id="divergence-heading" className="text-sm font-medium">
          Where the rating and the goals disagree
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          The computed score is put on this cycle&rsquo;s scale first, so the two numbers mean the
          same thing. A large gap is a question, not a verdict — the goals may have been the wrong
          goals.
        </p>

        {data.divergences.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            No appraisal diverges beyond the threshold.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm" data-testid="divergence-table">
            <caption className="sr-only">Appraisals whose manager rating diverges</caption>
            <thead>
              <tr>
                <th scope="col" className="pb-1">
                  Person
                </th>
                <th scope="col" className="pb-1 text-right">
                  Computed
                </th>
                <th scope="col" className="pb-1 text-right">
                  Manager
                </th>
                <th scope="col" className="pb-1 text-right">
                  Gap
                </th>
                <th scope="col" className="pb-1">
                  Final rating and why
                </th>
              </tr>
            </thead>
            <tbody>
              {data.divergences.map((row) => {
                const edit = edits[row.appraisalId] ?? { rating: '', reason: '' };
                const ready = edit.rating !== '' && edit.reason.trim() !== '';

                return (
                  <tr key={row.appraisalId} className="border-t align-top">
                    <td className="py-2">{row.userName}</td>
                    <td className="py-2 text-right tabular-nums">{row.computedOnScale}</td>
                    <td className="py-2 text-right tabular-nums">{row.managerRating}</td>
                    <td className="py-2 text-right tabular-nums">{row.divergence}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap items-start gap-2">
                        <label className="sr-only" htmlFor={`rating-${row.appraisalId}`}>
                          Final rating for {row.userName}
                        </label>
                        <input
                          id={`rating-${row.appraisalId}`}
                          type="number"
                          min={data.scale.min}
                          max={data.scale.max}
                          value={edit.rating}
                          onChange={(event) => {
                            setEdits((current) => ({
                              ...current,
                              [row.appraisalId]: { ...edit, rating: event.target.value },
                            }));
                          }}
                          className="w-20 rounded border px-2 py-1"
                        />

                        <label className="sr-only" htmlFor={`reason-${row.appraisalId}`}>
                          Reason for {row.userName}
                        </label>
                        <input
                          id={`reason-${row.appraisalId}`}
                          value={edit.reason}
                          placeholder="Why this changes"
                          onChange={(event) => {
                            setEdits((current) => ({
                              ...current,
                              [row.appraisalId]: { ...edit, reason: event.target.value },
                            }));
                          }}
                          className="min-w-48 flex-1 rounded border px-2 py-1"
                        />

                        <button
                          type="button"
                          onClick={() => {
                            adjust.mutate(
                              {
                                appraisalId: row.appraisalId,
                                finalRating: Number(edit.rating),
                                reason: edit.reason,
                              },
                              {
                                onSuccess: () => {
                                  toast.success(
                                    `${row.userName}'s rating adjusted. Their manager is notified with both numbers.`,
                                  );
                                  setEdits((current) => {
                                    const { [row.appraisalId]: _removed, ...rest } = current;
                                    return rest;
                                  });
                                },
                              },
                            );
                          }}
                          disabled={!ready || adjust.isPending}
                          className="rounded border px-3 py-1 disabled:opacity-50"
                        >
                          Adjust
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="release-heading" className="mt-10 rounded border p-4">
        <h2 id="release-heading" className="text-sm font-medium">
          Release results
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Releasing is one action for the whole cycle and cannot be undone. Everyone with a final
          rating is notified and can read it; ratings stop being changeable.
        </p>

        <button
          type="button"
          onClick={() => {
            release.mutate(undefined, {
              onSuccess: (result) => {
                setUnreleased([]);
                toast.success(`Released ${String(result.released)} results.`);
              },
              onError: (error) => {
                /*
                 * The refusal carries the names. US-803 asks for a pre-release
                 * report, and the server already computes exactly that list to
                 * decide it must refuse — so the refusal *is* the report, and
                 * a separate preview endpoint could only disagree with it.
                 */
                const detail = (error as { detail?: readonly string[] }).detail ?? [];

                setUnreleased(detail);
                toast.error(
                  detail.length === 0
                    ? error.message
                    : `${String(detail.length)} appraisals have no final rating yet.`,
                );
              },
            });
          }}
          disabled={release.isPending}
          className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {release.isPending ? 'Releasing…' : 'Lock and release'}
        </button>

        {unreleased.length > 0 && (
          <div className="mt-4" data-testid="unreleased">
            <p className="text-sm font-medium">Still waiting on a final rating</p>
            <ul className="mt-1 space-y-1 text-sm text-red-700">
              {unreleased.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * Per-manager means, as a table.
 *
 * A table rather than a chart because there can be dozens of managers and every
 * one of them carries meaning — the form guidance is explicit that past about
 * seven classes the answer is a table. The reader's job here is to find a name,
 * not to see a shape.
 */
function ManagerTable({
  byManager,
  orgMean,
}: {
  byManager: CalibrationResponse['byManager'];
  orgMean: number;
}) {
  return (
    <section aria-labelledby="manager-heading" className="mt-8">
      <h2 id="manager-heading" className="text-sm font-medium">
        By manager
      </h2>

      {byManager.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">Nobody has been rated yet.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm" data-testid="manager-table">
          <caption className="sr-only">Mean rating per manager, against the organization</caption>
          <thead>
            <tr>
              <th scope="col" className="pb-1">
                Manager
              </th>
              <th scope="col" className="pb-1 text-right">
                Rated
              </th>
              <th scope="col" className="pb-1 text-right">
                Mean
              </th>
              <th scope="col" className="pb-1 text-right">
                vs org
              </th>
              <th scope="col" className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {byManager.map((manager) => {
              const gap = Math.round((manager.mean - orgMean) * 100) / 100;

              return (
                <tr key={manager.managerId ?? 'unassigned'} className="border-t">
                  <td className="py-2">{manager.managerName}</td>
                  <td className="py-2 text-right tabular-nums">{manager.count}</td>
                  <td className="py-2 text-right tabular-nums">{manager.mean}</td>
                  <td className="py-2 text-right tabular-nums">
                    {gap > 0 ? `+${String(gap)}` : gap}
                  </td>
                  <td className="py-2">
                    {manager.outlier && (
                      /* The word, not a colour. The reader's next action is to
                         ask this person about it, and "the reddish row" is not
                         something you can put in a meeting invitation. */
                      <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                        Outlier
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
