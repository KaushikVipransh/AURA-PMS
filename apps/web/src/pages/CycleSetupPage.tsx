/**
 * Setting up a review cycle (PRD US-201, US-203, US-204) — W6-12.
 *
 * **This is the screen that replaces the prototype's global switch.** There
 * was one module-level `GLOBAL_ACTIVE_PERIOD` string, and its setter rewrote
 * the period on every goal sheet ever created — so "open the FY26 cycle"
 * silently reassigned five years of history to it (PLAN.md F-03). A cycle here
 * is a record with dated phases, its own rating scale and its own escalation
 * thresholds, and creating one cannot touch another.
 *
 * The scale is **snapshotted onto the cycle** (US-203), which is why it is set
 * at creation rather than in a global setting: changing 1–5 to 1–10 next year
 * must not re-interpret this year's ratings.
 *
 * Phases are laid out as a table of dates because that is what they are, and
 * the two rules that matter — no overlaps, and a cycle needs at least goal
 * setting and appraisal — are checked here *and* by `createCycleRequestSchema`
 * on the way in. The form's copy of the rule exists so somebody is told before
 * they submit; the schema's copy is the one that decides.
 */

import { PHASE_KEYS, findPhaseOverlaps, type PhaseKey } from '@aura/core';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  useActivateCycle,
  useCreateCycle,
  type EscalationRulesInput,
  type PhaseInput,
} from '../lib/admin.js';
import { asInstant, cycleBlockers, datedFully, defaultPhases, scaleLabels } from '../lib/cycle-rules.js';
import { activeCycle, useCycles } from '../lib/sheets.js';

const PHASE_LABELS: Readonly<Record<PhaseKey, string>> = {
  GOAL_SETTING: 'Goal setting',
  CHECK_IN: 'Check-ins',
  APPRAISAL: 'Appraisal',
  CALIBRATION: 'Calibration',
  RESULTS: 'Results',
};

export function CycleSetupPage() {
  const cycles = useCycles();
  const create = useCreateCycle();
  const activate = useActivateCycle();

  const [name, setName] = useState('');
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear());
  const [phases, setPhases] = useState<readonly PhaseInput[]>(defaultPhases(new Date()));
  const [scaleMax, setScaleMax] = useState(5);
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>(scaleLabels(1, 5));
  const [rules, setRules] = useState<EscalationRulesInput>({
    manager: 3,
    skipLevelHr: 7,
    rules: ['GOALS_NOT_SUBMITTED', 'GOALS_NOT_APPROVED'],
  });

  const blockers = cycleBlockers({ name, phases, labels, min: 1, max: scaleMax });

  /*
   * Only phases with two real dates are checked for overlap.
   *
   * `findPhaseOverlaps` asserts its inputs are valid dates and throws a
   * RangeError otherwise — correct for a domain function, and fatal here,
   * because this runs during render. Emptying a date field crashed the whole
   * page until this filter existed. The half-filled phase is not ignored: it
   * is reported by `cycleBlockers`, which is where a person is told about it.
   */
  const overlaps = findPhaseOverlaps(
    phases
      .filter((phase) => datedFully(phase))
      .map((phase) => ({
        key: phase.key,
        startsAt: new Date(phase.startsAt),
        endsAt: new Date(phase.endsAt),
      })),
  );

  function setPhase(key: PhaseKey, patch: Partial<PhaseInput>): void {
    setPhases((current) =>
      current.map((phase) => (phase.key === key ? { ...phase, ...patch } : phase)),
    );
  }

  function resize(max: number): void {
    setScaleMax(max);
    // Regenerated rather than patched: a scale that grew from 5 to 7 with two
    // unlabelled points is refused by the schema, and silently keeping stale
    // labels for points that no longer exist is worse.
    setLabels(scaleLabels(1, max));
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Set up a review cycle</h1>
      <p className="mt-1 text-sm text-slate-600">
        Each cycle carries its own phases, rating scale and escalation thresholds. Creating one
        never changes another — closing last year&rsquo;s leaves it readable exactly as it was.
      </p>

      <section aria-labelledby="basics-heading" className="mt-6 space-y-3">
        <h2 id="basics-heading" className="text-sm font-medium">
          The cycle
        </h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="cycle-name" className="text-sm">
            Name
          </label>
          <input
            id="cycle-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="FY26 Annual Review"
            className="rounded border px-3 py-2"
          />
        </div>

        <div className="flex w-40 flex-col gap-1">
          <label htmlFor="fiscal-year" className="text-sm">
            Fiscal year
          </label>
          <input
            id="fiscal-year"
            type="number"
            value={fiscalYear}
            onChange={(event) => {
              setFiscalYear(Number(event.target.value));
            }}
            className="rounded border px-3 py-2"
          />
        </div>
      </section>

      <section aria-labelledby="phases-heading" className="mt-8">
        <h2 id="phases-heading" className="text-sm font-medium">
          Phases
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          A phase runs from the first instant of its start to the first instant of its end, so one
          ending on the day the next begins is not an overlap.
        </p>

        <div className="mt-3 space-y-3">
          {PHASE_KEYS.map((key) => {
            const phase = phases.find((entry) => entry.key === key);

            return (
              <div key={key} className="flex flex-wrap items-end gap-3 rounded border p-3">
                <span className="w-32 text-sm font-medium">{PHASE_LABELS[key]}</span>

                <div className="flex flex-col gap-1">
                  <label htmlFor={`from-${key}`} className="text-xs">
                    From
                  </label>
                  <input
                    id={`from-${key}`}
                    type="date"
                    value={(phase?.startsAt ?? '').slice(0, 10)}
                    onChange={(event) => {
                      setPhase(key, { startsAt: asInstant(event.target.value) });
                    }}
                    className="rounded border px-3 py-2"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor={`to-${key}`} className="text-xs">
                    To
                  </label>
                  <input
                    id={`to-${key}`}
                    type="date"
                    value={(phase?.endsAt ?? '').slice(0, 10)}
                    onChange={(event) => {
                      setPhase(key, { endsAt: asInstant(event.target.value) });
                    }}
                    className="rounded border px-3 py-2"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {overlaps.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-red-700" data-testid="phase-overlaps">
            {overlaps.map((overlap) => (
              <li key={`${overlap.earlier}-${overlap.later}`}>
                {PHASE_LABELS[overlap.earlier]} overlaps {PHASE_LABELS[overlap.later]}.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="scale-heading" className="mt-8">
        <h2 id="scale-heading" className="text-sm font-medium">
          Rating scale
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Snapshotted onto this cycle. Changing it next year will not re-interpret ratings given
          under this one.
        </p>

        <div className="mt-3 flex w-40 flex-col gap-1">
          <label htmlFor="scale-max" className="text-sm">
            Points (1 to&hellip;)
          </label>
          <input
            id="scale-max"
            type="number"
            min={2}
            max={10}
            value={scaleMax}
            onChange={(event) => {
              resize(Number(event.target.value));
            }}
            className="rounded border px-3 py-2"
          />
        </div>

        <div className="mt-3 space-y-2">
          {Object.keys(labels)
            .sort((a, b) => Number(a) - Number(b))
            .map((point) => (
              <div key={point} className="flex items-center gap-3">
                <span className="w-8 text-sm">{point}</span>
                <input
                  aria-label={`Label for ${point}`}
                  value={labels[point] ?? ''}
                  onChange={(event) => {
                    setLabels((current) => ({ ...current, [point]: event.target.value }));
                  }}
                  className="flex-1 rounded border px-3 py-2"
                />
              </div>
            ))}
        </div>
      </section>

      <section aria-labelledby="escalation-heading" className="mt-8">
        <h2 id="escalation-heading" className="text-sm font-medium">
          Escalation thresholds
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          Days late before each tier is notified. Changes apply to future evaluations only —
          escalations already raised keep the thresholds they were raised under.
        </p>

        <div className="mt-3 flex gap-4">
          <div className="flex w-40 flex-col gap-1">
            <label htmlFor="tier-manager" className="text-sm">
              Manager
            </label>
            <input
              id="tier-manager"
              type="number"
              min={0}
              value={rules.manager}
              onChange={(event) => {
                setRules((current) => ({ ...current, manager: Number(event.target.value) }));
              }}
              className="rounded border px-3 py-2"
            />
          </div>

          <div className="flex w-40 flex-col gap-1">
            <label htmlFor="tier-hr" className="text-sm">
              Skip-level and HR
            </label>
            <input
              id="tier-hr"
              type="number"
              min={0}
              value={rules.skipLevelHr}
              onChange={(event) => {
                setRules((current) => ({ ...current, skipLevelHr: Number(event.target.value) }));
              }}
              className="rounded border px-3 py-2"
            />
          </div>
        </div>
      </section>

      <div className="mt-8">
        <button
          type="button"
          onClick={() => {
            create.mutate(
              {
                name,
                fiscalYear,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                phases,
                ratingScale: { min: 1, max: scaleMax, labels },
                escalationRules: rules,
              },
              {
                onSuccess: () => {
                  toast.success('Cycle created as a draft. Activate it when you are ready.');
                  setName('');
                },
              },
            );
          }}
          disabled={blockers.length > 0 || overlaps.length > 0 || create.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create as draft'}
        </button>

        <p className="mt-2 text-xs text-slate-600">
          Created cycles start as drafts. Nothing opens for employees until you activate one, and
          only one cycle can be active at a time.
        </p>

        {blockers.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm text-red-700" data-testid="cycle-blockers">
            {blockers.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>

      <section aria-labelledby="existing-heading" className="mt-10">
        <h2 id="existing-heading" className="text-sm font-medium">
          Cycles
        </h2>

        {cycles.isPending ? (
          <p className="mt-2 text-sm" role="status">
            Loading…
          </p>
        ) : (
          <ul className="mt-2 space-y-2" data-testid="cycle-list">
            {(cycles.data?.cycles ?? []).map((cycle) => (
              <li key={cycle.id} className="flex items-center gap-3 rounded border p-3 text-sm">
                <span className="flex-1">
                  {cycle.name} · {cycle.status.toLowerCase()}
                </span>

                {cycle.status === 'DRAFT' && (
                  <button
                    type="button"
                    onClick={() => {
                      activate.mutate(cycle.id, {
                        onSuccess: () => {
                          toast.success(`${cycle.name} is now the active cycle.`);
                        },
                      });
                    }}
                    disabled={activate.isPending}
                    className="rounded border px-3 py-1 disabled:opacity-50"
                  >
                    Activate
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {activeCycle(cycles.data?.cycles) !== null && (
          <p className="mt-3 text-xs text-slate-600">
            Activating a different cycle closes the current one. Its sheets, goals and ratings stay
            readable — closing a cycle has never deleted anything.
          </p>
        )}
      </section>
    </main>
  );
}
