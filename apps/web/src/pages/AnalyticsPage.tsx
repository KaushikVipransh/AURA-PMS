/**
 * Distribution analytics (PRD US-1001) — W6-15.
 *
 * **The charts replace key-value lists, and the counting stays in Postgres.**
 * F-13 was the prototype pulling every sheet into a serverless function and
 * counting with `forEach` — O(rows) memory, slowest exactly when analytics
 * matters. `GET /analytics` answers with one `UNION ALL` of grouped selects,
 * and this page renders what arrives. Nothing here sums or bins anything; a
 * browser that re-derived these numbers would be F-13 moved one layer out, with
 * every viewer paying it again.
 *
 * Four charts, one series each, so the comparison a reader makes is always
 * *within* a chart. The two headline numbers are stat tiles rather than a
 * fifth chart, because a single value with no distribution behind it is a
 * number, not a shape.
 */

import { THRUST_AREA_LABELS, UOM_LABELS, GOAL_STATUS_LABELS, labelFor } from '@aura/core';

import { DistributionChart, type Slice } from '../components/DistributionChart.js';
import { useAnalytics, type AnalyticsBucket } from '../lib/governance.js';
import { activeCycle, useCycles } from '../lib/sheets.js';

/** Enum values become the words people use, from the one label table. */
function humanise(
  buckets: readonly AnalyticsBucket[],
  labels: Readonly<Record<string, string>>,
): Slice[] {
  return buckets.map((bucket) => ({
    label: labelFor(labels, bucket.bucket),
    count: bucket.count,
  }));
}

const SHEET_STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: 'Draft',
  PENDING: 'Awaiting approval',
  RETURNED: 'Returned',
  APPROVED: 'Approved',
};

export function AnalyticsPage() {
  const cycles = useCycles();
  const cycle = activeCycle(cycles.data?.cycles);
  const analytics = useAnalytics(cycle?.id ?? null);

  if (cycles.isPending || analytics.isPending) {
    return (
      <p className="p-8 text-sm" role="status">
        Loading…
      </p>
    );
  }

  const data = analytics.data;

  if (data === undefined || cycle === null) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="mt-3 text-sm text-slate-600">
          There is no cycle to report on yet.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-slate-600">
        {cycle.name} · counted by the database, not in the browser.
      </p>

      {/* Two headline numbers. A chart of one value would be furniture. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2" data-testid="analytics-totals">
        <div className="rounded border p-4">
          <p className="text-sm text-slate-600">Goal sheets</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{data.totalSheets}</p>
        </div>
        <div className="rounded border p-4">
          <p className="text-sm text-slate-600">Goals</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{data.totalGoals}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <DistributionChart
          title="Goals by thrust area"
          testId="chart-thrust"
          slices={humanise(data.byThrustArea, THRUST_AREA_LABELS)}
          caption="Where the organization has pointed its attention this cycle."
        />

        <DistributionChart
          title="Goals by unit of measure"
          testId="chart-uom"
          slices={humanise(data.byUom, UOM_LABELS)}
          caption="How goals are being measured. A cycle of nothing but yes/no goals is a cycle nobody can score finely."
        />

        <DistributionChart
          title="Goals by status"
          testId="chart-goal-status"
          slices={humanise(data.byGoalStatus, GOAL_STATUS_LABELS)}
          caption="Progress as reported at the last check-in."
        />

        <DistributionChart
          title="Sheets by status"
          testId="chart-sheet-status"
          slices={humanise(data.bySheetStatus, SHEET_STATUS_LABELS)}
          caption="Where sheets are in the approval workflow."
        />
      </div>
    </main>
  );
}
