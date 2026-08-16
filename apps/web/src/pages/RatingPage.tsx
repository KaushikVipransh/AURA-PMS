/**
 * Rating a report (PRD US-702) — W6-11.
 *
 * **Side by side is the requirement, not the styling.** Each goal shows what
 * the person said about it, what the engine computed from the numbers, and the
 * rating field — in one row, so the manager is rating *against* the evidence
 * rather than remembering it from another screen. The check-in history sits
 * underneath for the same reason: the actual achievement is a figure with a
 * history, and "80%" reached in the last week is not the same year as "80%"
 * reached in month two.
 *
 * A narrative is required on every goal and on the overall rating. That is
 * US-702's acceptance criterion and it is also PLAN.md F-14 — the prototype
 * had no manager rating at all, and the half that gets skipped when a rating
 * screen is built in a hurry is always the justification.
 *
 * The scale comes from the cycle (US-203), never from a constant here: a 7 on
 * a 1–5 cycle is a number that parses and means nothing, and the server refuses
 * it. The inputs are bounded by the same values the server checks against.
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useReview, useSubmitRating } from '../lib/manager.js';
import { activeCycle, useAppraisal, useCycles } from '../lib/sheets.js';
import { useInitialisedFrom } from '../lib/useInitialisedFrom.js';

type Entry = { rating: number | null; commentary: string };

export function RatingPage() {
  const { sheetId = '' } = useParams<{ sheetId: string }>();
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);
  const appraisal = useAppraisal(sheetId === '' ? null : sheetId);
  const review = useReview(sheetId === '' ? null : sheetId);
  const submit = useSubmitRating(cycle?.id ?? '', sheetId);

  const data = appraisal.data;

  const [entries, setEntries] = useInitialisedFrom(
    data,
    (loaded) =>
      Object.fromEntries(
        loaded.goals.map((goal) => [
          goal.id,
          { rating: goal.managerRating, commentary: goal.managerNarrative ?? '' },
        ]),
      ) as Record<string, Entry>,
    {},
  );

  const [overall, setOverall] = useInitialisedFrom(
    data,
    (loaded) => loaded.appraisal?.managerRating ?? null,
    null as number | null,
  );

  const [justification, setJustification] = useState('');

  const blockers = useMemo(() => {
    if (data === undefined) {
      return [];
    }

    const reasons: string[] = [];

    for (const goal of data.goals) {
      const entry = entries[goal.id];

      if (entry?.rating == null) {
        reasons.push(`${goal.title} needs a rating.`);
      }
      if ((entry?.commentary ?? '').trim() === '') {
        reasons.push(`${goal.title} needs a justification.`);
      }
    }

    if (overall === null) {
      reasons.push('Give an overall rating.');
    }
    if (justification.trim() === '') {
      reasons.push('Justify the overall rating.');
    }

    return reasons;
  }, [data, entries, overall, justification]);

  if (appraisal.isPending || review.isPending) {
    return (
      <p className="p-8 text-sm" role="status">
        Loading…
      </p>
    );
  }

  if (data === undefined) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <h1 className="text-2xl font-semibold">Rating</h1>
        <p className="mt-3 text-sm text-slate-600">
          There is no appraisal to rate here yet. One opens once the sheet is approved and the
          appraisal window is open.
        </p>
        <Link to="/queue" className="mt-4 inline-block text-sm underline">
          Back to the queue
        </Link>
      </main>
    );
  }

  const selfIn = data.appraisal?.selfSubmittedAt != null;
  const rated = data.appraisal?.managerRating != null;
  const { min, max } = data.scale;

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link to="/queue" className="text-sm underline">
        ← Queue
      </Link>

      <h1 className="mt-2 text-2xl font-semibold">
        Rate {review.data?.owner.name ?? 'this report'}
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle?.name} · computed score {Math.round(data.computedScore * 100)}% (
        {data.computedOnScale.toFixed(1)} on a {min}–{max} scale)
      </p>

      {!selfIn && (
        /* The server refuses this too — US-702 says a manager cannot rate
           before the self-appraisal lands or its deadline passes. Saying so
           here means finding out before writing 400 words. */
        <p role="status" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Their self-appraisal has not been submitted yet. You can rate once it arrives, or once
          its deadline passes.
        </p>
      )}

      {rated && (
        <p role="status" className="mt-4 rounded border p-3 text-sm">
          You have already submitted a rating. Changes go through calibration from here.
        </p>
      )}

      <ol className="mt-6 space-y-4">
        {data.goals.map((goal) => (
          <li key={goal.id} className="rounded border p-4">
            <h2 className="font-medium">{goal.title}</h2>

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {/* Left: the evidence. Right: the judgement. */}
              <div className="text-sm">
                <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-slate-600">
                  <dt>Target</dt>
                  <dt>Actual</dt>
                  <dt>Score</dt>
                  <dd>{goal.target}</dd>
                  <dd data-testid={`actual-${goal.id}`}>{goal.actualAchievement ?? '—'}</dd>
                  <dd data-testid={`score-${goal.id}`}>
                    {Math.round(goal.computedScore * 100)}%
                  </dd>
                </dl>

                <p className="mt-3 font-medium">What they said</p>
                <p
                  className="mt-1 whitespace-pre-wrap text-slate-700"
                  data-testid={`self-${goal.id}`}
                >
                  {goal.selfNarrative ?? 'Nothing written for this goal.'}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex w-32 flex-col gap-1">
                  <label htmlFor={`rating-${goal.id}`} className="text-sm">
                    Rating ({min}–{max})
                  </label>
                  <input
                    id={`rating-${goal.id}`}
                    type="number"
                    min={min}
                    max={max}
                    disabled={!selfIn}
                    value={entries[goal.id]?.rating ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;

                      setEntries((all) => ({
                        ...all,
                        [goal.id]: {
                          commentary: all[goal.id]?.commentary ?? '',
                          rating: value === '' ? null : Number(value),
                        },
                      }));
                    }}
                    className="rounded border px-3 py-2"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor={`why-${goal.id}`} className="text-sm">
                    Why this rating?
                  </label>
                  <textarea
                    id={`why-${goal.id}`}
                    rows={3}
                    disabled={!selfIn}
                    value={entries[goal.id]?.commentary ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;

                      setEntries((all) => ({
                        ...all,
                        [goal.id]: {
                          rating: all[goal.id]?.rating ?? null,
                          commentary: value,
                        },
                      }));
                    }}
                    className="rounded border px-3 py-2"
                  />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="text-sm font-medium">
          Check-in history
        </h2>
        {(review.data?.checkIns ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No progress was recorded during the cycle.</p>
        ) : (
          <ol className="mt-2 space-y-2 text-sm" data-testid="rating-check-ins">
            {(review.data?.checkIns ?? []).map((event) => (
              <li key={event.at} className="rounded border p-3">
                <p className="text-slate-600">{new Date(event.at).toLocaleDateString()}</p>
                <ul className="mt-1 space-y-1">
                  {event.changes.map((change) => (
                    <li key={change.goalId}>
                      {change.title}: {change.fromActual ?? '—'} → {change.toActual ?? '—'}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="mt-8 rounded border p-4">
        <div className="flex w-40 flex-col gap-1">
          <label htmlFor="overall" className="text-sm font-medium">
            Overall rating ({min}–{max})
          </label>
          <input
            id="overall"
            type="number"
            min={min}
            max={max}
            disabled={!selfIn}
            value={overall ?? ''}
            onChange={(event) => {
              setOverall(event.target.value === '' ? null : Number(event.target.value));
            }}
            className="rounded border px-3 py-2"
          />
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <label htmlFor="justification" className="text-sm font-medium">
            Justification
          </label>
          <textarea
            id="justification"
            rows={4}
            disabled={!selfIn}
            value={justification}
            onChange={(event) => {
              setJustification(event.target.value);
            }}
            className="rounded border px-3 py-2"
          />
          <p className="text-xs text-slate-600">
            This is what they read when the results are released, and what calibration reviews.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            submit.mutate(
              {
                ratings: data.goals.map((goal) => ({
                  goalId: goal.id,
                  rating: entries[goal.id]?.rating ?? min,
                  commentary: entries[goal.id]?.commentary ?? '',
                })),
                overallRating: overall ?? min,
                justification,
              },
              {
                onSuccess: () => {
                  toast.success('Rating submitted.');
                },
              },
            );
          }}
          disabled={!selfIn || blockers.length > 0 || submit.isPending}
          className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Submit rating
        </button>

        {blockers.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-red-700" data-testid="rating-blockers">
            {blockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
