/**
 * The self-appraisal (PRD US-701) — W6-08.
 *
 * **Never a blank page.** The story's whole complaint is that writing a
 * self-appraisal from nothing is why they arrive late and thin. Every goal
 * comes back with its target, its actual and its computed score already filled
 * in by the server, so the only thing left to supply is the part only this
 * person can: what happened, and why.
 *
 * The score beside each goal is the W2-01 engine's, computed server-side. The
 * prototype worked it out in two separate JSX components, so the number an
 * employee saw and the number their manager saw could drift with a deploy
 * (F-07).
 */

import { toast } from 'sonner';

import {
  activeCycle,
  useAppraisal,
  useCycles,
  useSaveSelfAppraisal,
  useSheet,
} from '../lib/sheets.js';
import { useInitialisedFrom } from '../lib/useInitialisedFrom.js';

export function AppraisalPage() {
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);
  const sheet = useSheet(cycle?.id ?? null);
  const sheetId = sheet.data?.sheet.id ?? null;
  const appraisal = useAppraisal(sheetId);
  const save = useSaveSelfAppraisal(sheetId ?? '');

  const data = appraisal.data;

  const [entries, setEntries] = useInitialisedFrom(
    data,
    (loaded) =>
      Object.fromEntries(loaded.goals.map((goal) => [goal.id, goal.selfNarrative ?? ''])),
    {},
  );

  const [summary, setSummary] = useInitialisedFrom(
    data,
    (loaded) => loaded.appraisal?.selfNarrative ?? '',
    '',
  );

  if (cycles.isPending || sheet.isPending || appraisal.isPending) {
    return (
      <p className="p-8 text-sm" role="status">
        Loading…
      </p>
    );
  }

  if (data === undefined) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Self-appraisal</h1>
        <p className="mt-3 text-sm text-slate-600">
          A self-appraisal opens once your goal sheet has been approved.
        </p>
      </main>
    );
  }

  const submitted = data.appraisal?.selfSubmittedAt != null;
  const missing = data.goals.filter((goal) => (entries[goal.id] ?? '').trim() === '');
  const blockers = [
    ...missing.map((goal) => `${goal.title} needs a reflection.`),
    ...(summary.trim() === '' ? ['Add an overall summary.'] : []),
  ];

  const draft = {
    entries: data.goals.map((goal) => ({
      goalId: goal.id,
      commentary: entries[goal.id] ?? '',
    })),
    summary,
  };

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Self-appraisal</h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle?.name} · computed score {Math.round(data.computedScore * 100)}% (
        {data.computedOnScale.toFixed(1)} on a {data.scale.min}–{data.scale.max} scale)
      </p>

      {submitted && (
        <p role="status" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          You submitted this appraisal. It is locked so your manager rates against what you wrote.
        </p>
      )}

      <ol className="mt-6 space-y-4">
        {data.goals.map((goal) => (
          <li key={goal.id} className="rounded border p-4">
            <h2 className="font-medium">{goal.title}</h2>

            {/* Pre-populated. Not starting from nothing is the whole story. */}
            <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1 text-sm text-slate-600">
              <dt>Target</dt>
              <dt>Actual</dt>
              <dt>Score</dt>
              <dd data-testid={`target-${goal.id}`}>{goal.target}</dd>
              <dd data-testid={`actual-${goal.id}`}>{goal.actualAchievement ?? '—'}</dd>
              <dd data-testid={`score-${goal.id}`}>{Math.round(goal.computedScore * 100)}%</dd>
            </dl>

            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor={`reflection-${goal.id}`} className="text-sm">
                What happened, and why?
              </label>
              <textarea
                id={`reflection-${goal.id}`}
                rows={3}
                disabled={submitted}
                value={entries[goal.id] ?? ''}
                onChange={(event) => {
                  setEntries((all) => ({ ...all, [goal.id]: event.target.value }));
                }}
                className="rounded border px-3 py-2"
              />
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-col gap-1">
        <label htmlFor="summary" className="text-sm font-medium">
          Overall summary
        </label>
        <textarea
          id="summary"
          rows={4}
          disabled={submitted}
          value={summary}
          onChange={(event) => {
            setSummary(event.target.value);
          }}
          className="rounded border px-3 py-2"
        />
      </div>

      {!submitted && (
        <>
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => {
                save.mutate(
                  { draft, submit: false },
                  {
                    onSuccess: () => {
                      toast.success('Draft saved.');
                    },
                  },
                );
              }}
              disabled={save.isPending || blockers.length > 0}
              className="rounded border px-4 py-2 text-sm disabled:opacity-50"
            >
              Save draft
            </button>

            <button
              type="button"
              onClick={() => {
                save.mutate(
                  { draft, submit: true },
                  {
                    onSuccess: () => {
                      toast.success('Self-appraisal submitted.');
                    },
                  },
                );
              }}
              disabled={save.isPending || blockers.length > 0}
              className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Submit
            </button>
          </div>

          {blockers.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm text-red-700" data-testid="appraisal-blockers">
              {blockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-xs text-slate-600">
            Submitting locks this appraisal so your manager rates against what you wrote.
          </p>
        </>
      )}
    </main>
  );
}
