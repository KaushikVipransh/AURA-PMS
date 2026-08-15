/**
 * The goal builder (PRD US-301, US-302, US-303) — W6-06.
 *
 * Three prototype failures meet here:
 *
 *   - **F-06.** Direction was inferred from the title by substring match, so
 *     "Reduce customer wait time" scored inversely by accident. It is a
 *     required choice now, and each option says what it does to the score —
 *     because a required field someone does not understand is a guess with
 *     extra steps.
 *   - **F-10.** Three different weightage checks disagreed. The meter, the
 *     schema and the API all call `validateWeightages`.
 *   - **F-14.** Failures arrived as `alert('Error')`. A blocked submit here
 *     lists every reason, each naming the goal it belongs to.
 */

import {
  GOAL_DIRECTIONS,
  MAX_GOALS_PER_SHEET,
  THRUST_AREA_LABELS,
  UOMS,
  UOM_EXPLANATIONS,
  UOM_LABELS,
  DIRECTION_EXPLANATIONS,
  DIRECTION_LABELS,
  labelFor,
} from '@aura/core';
import { THRUST_AREAS, type ThrustArea, type Uom } from '@aura/contracts';
import { toast } from 'sonner';

import { WeightageMeter } from '../components/WeightageMeter.js';
import { submitBlockers } from '../lib/goal-rules.js';
import { useInitialisedFrom } from '../lib/useInitialisedFrom.js';
import {
  activeCycle,
  useCycles,
  useSaveDraft,
  useSheet,
  useSubmitSheet,
  type GoalDraft,
} from '../lib/sheets.js';

/** A blank row, with no direction preselected. */
function emptyGoal(): GoalDraft {
  return {
    thrustArea: 'BUSINESS_GROWTH',
    title: '',
    uom: 'NUMERIC',
    /*
     * Defaulted, and this is the one field where that is a real decision.
     * Leaving it unset would show an empty select that someone can submit past
     * without reading; HIGHER_IS_BETTER is the common case and the explanation
     * beside it is what makes the choice deliberate. The *schema* still
     * requires it, so nothing infers it downstream.
     */
    direction: 'HIGHER_IS_BETTER',
    target: '',
    weightage: 0,
  };
}

export function GoalsPage() {
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);
  const sheet = useSheet(cycle?.id ?? null);
  const saveDraft = useSaveDraft(cycle?.id ?? '');
  const submitSheet = useSubmitSheet(cycle?.id ?? '');

  const [goals, setGoals] = useInitialisedFrom(
    sheet.data?.sheet.goals,
    (serverGoals) =>
      serverGoals.map((goal) => ({
        thrustArea: goal.thrustArea,
        title: goal.title,
        uom: goal.uom,
        direction: goal.direction,
        target: goal.target,
        weightage: Number(goal.weightage),
      })),
    [],
  );

  const status = sheet.data?.sheet.status ?? 'DRAFT';
  const editable = status === 'DRAFT' || status === 'RETURNED';
  const blockers = submitBlockers(goals);

  function update(index: number, patch: Partial<GoalDraft>): void {
    setGoals((current) => current.map((goal, i) => (i === index ? { ...goal, ...patch } : goal)));
  }

  if (cycles.isPending) {
    return <p className="p-8 text-sm" role="status">Loading…</p>;
  }

  if (cycle === null) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">My goals</h1>
        <p className="mt-3 text-sm text-slate-600">
          There is no open review cycle yet. Your HR team creates one before goal setting opens.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">My goals</h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle.name} · {labelFor({ DRAFT: 'Draft', PENDING: 'Awaiting approval', RETURNED: 'Returned for changes', APPROVED: 'Approved' }, status)}
      </p>

      {!editable && (
        <p role="status" className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          This sheet is {status.toLowerCase()} and can no longer be edited.
        </p>
      )}

      <div className="mt-6">
        <WeightageMeter
          goals={goals.map((goal, index) => ({
            title: goal.title || `Goal ${String(index + 1)}`,
            weightage: goal.weightage,
          }))}
        />
      </div>

      <ol className="mt-6 space-y-6">
        {goals.map((goal, index) => (
          <li key={index} className="rounded border p-4">
            <fieldset disabled={!editable} className="space-y-3">
              <legend className="text-sm font-medium">Goal {index + 1}</legend>

              <div className="flex flex-col gap-1">
                <label htmlFor={`title-${String(index)}`} className="text-sm">Title</label>
                <input
                  id={`title-${String(index)}`}
                  value={goal.title}
                  onChange={(event) => { update(index, { title: event.target.value }); }}
                  className="rounded border px-3 py-2"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`thrust-${String(index)}`} className="text-sm">Thrust area</label>
                <select
                  id={`thrust-${String(index)}`}
                  value={goal.thrustArea}
                  onChange={(event) => { update(index, { thrustArea: event.target.value as ThrustArea }); }}
                  className="rounded border px-3 py-2"
                >
                  {THRUST_AREAS.map((area) => (
                    <option key={area} value={area}>{labelFor(THRUST_AREA_LABELS, area)}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`uom-${String(index)}`} className="text-sm">Unit of measure</label>
                <select
                  id={`uom-${String(index)}`}
                  value={goal.uom}
                  onChange={(event) => { update(index, { uom: event.target.value as Uom }); }}
                  aria-describedby={`uom-help-${String(index)}`}
                  className="rounded border px-3 py-2"
                >
                  {UOMS.map((uom) => (
                    <option key={uom} value={uom}>{UOM_LABELS[uom]}</option>
                  ))}
                </select>
                <p id={`uom-help-${String(index)}`} className="text-xs text-slate-600">
                  {UOM_EXPLANATIONS[goal.uom]}
                </p>
              </div>

              {/*
                * The F-06 control.
                *
                * A radio group rather than a select, so both options and both
                * explanations are visible at once — the choice is between two
                * consequences, and a collapsed select shows only the one
                * already picked.
                */}
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm">Which direction is good?</legend>
                {GOAL_DIRECTIONS.map((direction) => (
                  <label key={direction} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name={`direction-${String(index)}`}
                      value={direction}
                      checked={goal.direction === direction}
                      onChange={() => { update(index, { direction }); }}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{DIRECTION_LABELS[direction]}</span>
                      <span className="block text-xs text-slate-600">
                        {DIRECTION_EXPLANATIONS[direction]}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="flex gap-4">
                <div className="flex flex-1 flex-col gap-1">
                  <label htmlFor={`target-${String(index)}`} className="text-sm">Target</label>
                  <input
                    id={`target-${String(index)}`}
                    value={goal.target}
                    onChange={(event) => { update(index, { target: event.target.value }); }}
                    className="rounded border px-3 py-2"
                  />
                </div>

                <div className="flex w-32 flex-col gap-1">
                  <label htmlFor={`weightage-${String(index)}`} className="text-sm">Weightage %</label>
                  <input
                    id={`weightage-${String(index)}`}
                    type="number"
                    inputMode="decimal"
                    value={goal.weightage}
                    onChange={(event) => { update(index, { weightage: Number(event.target.value) }); }}
                    className="rounded border px-3 py-2"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => { setGoals((current) => current.filter((_, i) => i !== index)); }}
                className="text-sm text-red-700 underline"
              >
                Remove goal {index + 1}
              </button>
            </fieldset>
          </li>
        ))}
      </ol>

      {editable && (
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => { setGoals((current) => [...current, emptyGoal()]); }}
            disabled={goals.length >= MAX_GOALS_PER_SHEET}
            className="rounded border px-4 py-2 text-sm disabled:opacity-50"
          >
            Add a goal
          </button>

          <button
            type="button"
            onClick={() => {
              saveDraft.mutate(goals, {
                onSuccess: () => { toast.success('Draft saved.'); },
              });
            }}
            disabled={saveDraft.isPending}
            className="rounded border px-4 py-2 text-sm"
          >
            {saveDraft.isPending ? 'Saving…' : 'Save draft'}
          </button>

          <button
            type="button"
            onClick={() => {
              const id = sheet.data?.sheet.id;

              if (id === undefined) {
                toast.error('Save a draft before submitting.');
                return;
              }
              submitSheet.mutate(id, {
                onSuccess: () => { toast.success('Submitted for approval.'); },
              });
            }}
            disabled={blockers.length > 0 || submitSheet.isPending}
            className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Submit for approval
          </button>
        </div>
      )}

      {editable && blockers.length > 0 && (
        <section aria-labelledby="blockers-heading" className="mt-4">
          <h2 id="blockers-heading" className="text-sm font-medium">
            Before you can submit
          </h2>
          {/*
            * Every reason, each naming its goal. The prototype showed
            * `alert('Error')` and left the person to find it (F-14).
            */}
          <ul className="mt-2 space-y-1 text-sm text-red-700" data-testid="submit-blockers">
            {blockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
