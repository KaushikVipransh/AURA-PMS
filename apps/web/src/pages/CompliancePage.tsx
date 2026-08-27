/**
 * The compliance and escalation board (PRD US-903, US-904) — W6-16.
 *
 * **Every overdue number here is real.** The prototype's escalation engine
 * computed lateness as `Math.max(elapsedDays, 4)` — a floor of four days on
 * everything, so a sheet that became due an hour ago was reported as four days
 * overdue and escalated accordingly (PLAN.md F-08). The API computes real
 * calendar days in each subject's own timezone, with no floor, and this page
 * prints what it is given. Someone in Auckland and someone in Los Angeles do
 * not cross midnight together.
 *
 * The top of the page is four meters rather than four charts: each is one ratio
 * against one limit, and the prototype's key-value list made the reader do the
 * division. Underneath is the board itself — a table, because the reader is
 * looking for a name and a next action, not for a shape.
 *
 * **A resolution note is required.** US-904 says so, the schema says so, and
 * the button stays disabled until one is written — the last of those is the
 * only one that tells somebody before they have moved on.
 */

import { useState } from 'react';
import { toast } from 'sonner';

import { CompletionMeter } from '../components/CompletionMeter.js';
import {
  useCompliance,
  useEscalations,
  useResolveEscalation,
  type EscalationFilters,
} from '../lib/governance.js';
import { activeCycle, useCycles } from '../lib/sheets.js';

/**
 * Tiers, in words.
 *
 * The colours are reinforcement only: the tier is always written out beside
 * them. Two of the status steps sit below 3:1 on a white surface by design, and
 * the label is the documented mitigation — a status colour never carries
 * meaning on its own here.
 */
const TIER_LABELS: Readonly<Record<string, string>> = {
  EMPLOYEE: 'With the employee',
  MANAGER: 'Escalated to the manager',
  SKIP_LEVEL_HR: 'Escalated to skip-level and HR',
};

const TIER_STYLES: Readonly<Record<string, string>> = {
  EMPLOYEE: 'border-slate-300 bg-slate-50 text-slate-800',
  MANAGER: 'border-amber-300 bg-amber-50 text-amber-900',
  SKIP_LEVEL_HR: 'border-red-300 bg-red-50 text-red-900',
};

const RULE_LABELS: Readonly<Record<string, string>> = {
  GOALS_NOT_SUBMITTED: 'Goals not submitted',
  APPROVAL_OVERDUE: 'Approval overdue',
  CHECK_IN_MISSING: 'Check-in missing',
  SELF_APPRAISAL_OVERDUE: 'Self-appraisal overdue',
  MANAGER_RATING_OVERDUE: 'Manager rating overdue',
};

export function CompliancePage() {
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);

  const [filters, setFilters] = useState<EscalationFilters>({ status: 'ACTIVE' });
  const [notes, setNotes] = useState<Record<string, string>>({});

  const compliance = useCompliance(cycle?.id ?? null);
  const escalations = useEscalations(cycle?.id ?? null, filters);
  const resolve = useResolveEscalation(cycle?.id ?? '');

  if (cycles.isPending || compliance.isPending) {
    return (
      <p className="p-8 text-sm" role="status">
        Loading…
      </p>
    );
  }

  const summary = compliance.data;

  if (summary === undefined || cycle === null) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <h1 className="text-2xl font-semibold">Compliance</h1>
        <p className="mt-3 text-sm text-slate-600">There is no cycle to report on yet.</p>
      </main>
    );
  }

  const items = escalations.data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Compliance</h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle.name} · {summary.totalUsers} people · {summary.openEscalations} open escalations
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="compliance-meters">
        <CompletionMeter
          label="Sheets submitted"
          done={summary.sheetsSubmitted}
          total={summary.totalUsers}
          testId="meter-submitted"
        />
        <CompletionMeter
          label="Sheets approved"
          done={summary.sheetsApproved}
          total={summary.totalUsers}
          testId="meter-approved"
        />
        <CompletionMeter
          label="Self-appraisals in"
          done={summary.selfAppraisalsComplete}
          total={summary.totalUsers}
          testId="meter-self"
        />
        <CompletionMeter
          label="Manager ratings in"
          done={summary.managerRatingsComplete}
          total={summary.totalUsers}
          testId="meter-ratings"
        />
      </div>

      <section aria-labelledby="board-heading" className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="board-heading" className="text-sm font-medium">
            Escalations
          </h2>

          <div className="flex gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="filter-status" className="text-sm">
                Status
              </label>
              <select
                id="filter-status"
                value={filters.status ?? ''}
                onChange={(event) => {
                  const value = event.target.value;

                  setFilters((current) => ({
                    ...current,
                    status: value === '' ? undefined : (value as 'ACTIVE' | 'RESOLVED'),
                  }));
                }}
                className="rounded border px-3 py-2 text-sm"
              >
                <option value="ACTIVE">Open</option>
                <option value="RESOLVED">Resolved</option>
                <option value="">All</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="filter-tier" className="text-sm">
                Tier
              </label>
              <select
                id="filter-tier"
                value={filters.tier ?? ''}
                onChange={(event) => {
                  const value = event.target.value;

                  setFilters((current) => ({
                    ...current,
                    tier: value === '' ? undefined : (value as EscalationFilters['tier']),
                  }));
                }}
                className="rounded border px-3 py-2 text-sm"
              >
                <option value="">Every tier</option>
                {Object.entries(TIER_LABELS).map(([tier, label]) => (
                  <option key={tier} value={tier}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {escalations.isPending ? (
          <p className="mt-3 text-sm" role="status">
            Loading escalations…
          </p>
        ) : items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            Nothing outstanding. An escalation re-opens by itself if the condition comes back.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm" data-testid="escalation-table">
            <caption className="sr-only">Open escalations for this cycle</caption>
            <thead>
              <tr>
                <th scope="col" className="pb-1">
                  Person
                </th>
                <th scope="col" className="pb-1">
                  What is late
                </th>
                <th scope="col" className="pb-1">
                  Tier
                </th>
                <th scope="col" className="pb-1 text-right">
                  Days late
                </th>
                <th scope="col" className="pb-1">
                  Resolve with a note
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const note = notes[item.id] ?? '';

                return (
                  <tr key={item.id} className="border-t align-top">
                    <td className="py-2">{item.subjectName}</td>
                    <td className="py-2">{RULE_LABELS[item.rule] ?? item.rule}</td>
                    <td className="py-2">
                      {/* Colour and the words. Never the colour alone. */}
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${
                          TIER_STYLES[item.tier] ?? TIER_STYLES['EMPLOYEE'] ?? ''
                        }`}
                      >
                        {TIER_LABELS[item.tier] ?? item.tier}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {/* No floor. `0` means it became due today, and 0 is a
                          legitimate answer (F-08). */}
                      {item.daysOverdue}
                    </td>
                    <td className="py-2">
                      {item.status === 'RESOLVED' ? (
                        <span className="text-slate-600">{item.resolutionNote}</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <label className="sr-only" htmlFor={`note-${item.id}`}>
                            Resolution note for {item.subjectName}
                          </label>
                          <input
                            id={`note-${item.id}`}
                            value={note}
                            placeholder="What was done"
                            onChange={(event) => {
                              setNotes((current) => ({ ...current, [item.id]: event.target.value }));
                            }}
                            className="min-w-48 flex-1 rounded border px-2 py-1"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              resolve.mutate(
                                { id: item.id, note },
                                {
                                  onSuccess: () => {
                                    toast.success('Resolved. It will stop notifying.');
                                    setNotes((current) => {
                                      const { [item.id]: _removed, ...rest } = current;
                                      return rest;
                                    });
                                  },
                                },
                              );
                            }}
                            disabled={note.trim() === '' || resolve.isPending}
                            className="rounded border px-3 py-1 disabled:opacity-50"
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <p className="mt-3 text-xs text-slate-600">
          Resolving stops the notifications and excludes the item from future evaluation. If the
          underlying condition recurs, a new escalation is raised — resolving is not a way to make
          a missed deadline permanently invisible.
        </p>
      </section>
    </main>
  );
}
