import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../lib/query.js';
import { AnalyticsPage } from './AnalyticsPage.js';
import { CalibrationPage } from './CalibrationPage.js';
import { CompliancePage } from './CompliancePage.js';

/**
 * W6-14, W6-15, W6-16 — calibration, analytics and the compliance board.
 *
 * The charts are asserted through their **table**, not their SVG. That is not a
 * workaround: the table is the accessible rendering of the same numbers and is
 * always in the DOM, whereas a Recharts SVG in jsdom has no layout and its bar
 * geometry means nothing. Asserting on the table checks what a reader actually
 * gets; asserting on `<path d="...">` would check that Recharts is Recharts.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Longest fragment first, so `/calibration/adjust` never matches as `/calibration`. */
function serve(routes: Readonly<Record<string, unknown>>): void {
  const ordered = Object.entries(routes).sort(([a], [b]) => b.length - a.length);

  fetchMock.mockImplementation((url: string) => {
    for (const [fragment, body] of ordered) {
      if (String(url).includes(fragment)) {
        return Promise.resolve(json(body));
      }
    }
    return Promise.resolve(json({ ok: true }));
  });
}

const render_ = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

function lastBody(fragment: string): Record<string, unknown> {
  const calls = fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url).includes(fragment) &&
      typeof (init as { body?: unknown } | undefined)?.body === 'string',
  );
  const last = calls[calls.length - 1];

  return JSON.parse(String((last?.[1] as { body?: string } | undefined)?.body)) as Record<
    string,
    unknown
  >;
}

const CYCLE = { id: 'cyc1', name: 'FY26', fiscalYear: 2026, status: 'ACTIVE', phases: [] };
const CYCLES = { cycles: [CYCLE] };

describe('AnalyticsPage [W6-15]', () => {
  const ANALYTICS = {
    cycleId: 'cyc1',
    totalSheets: 180,
    totalGoals: 742,
    byThrustArea: [
      { bucket: 'BUSINESS_GROWTH', count: 300 },
      { bucket: 'OPERATIONAL_EXCELLENCE', count: 442 },
    ],
    byUom: [{ bucket: 'PERCENT', count: 742 }],
    byGoalStatus: [{ bucket: 'ON_TRACK', count: 742 }],
    bySheetStatus: [{ bucket: 'APPROVED', count: 180 }],
  };

  it('shows the headline counts as numbers, not as a chart', async () => {
    serve({ '/cycles': CYCLES, '/analytics': ANALYTICS });

    render_(<AnalyticsPage />);

    // A single value with no distribution behind it is a number, not a shape.
    const totals = await screen.findByTestId('analytics-totals');
    expect(totals).toHaveTextContent('180');
    expect(totals).toHaveTextContent('742');
  });

  it('renders every distribution the server counted', async () => {
    serve({ '/cycles': CYCLES, '/analytics': ANALYTICS });

    render_(<AnalyticsPage />);

    await screen.findByTestId('chart-thrust');
    expect(screen.getByTestId('chart-uom')).toBeInTheDocument();
    expect(screen.getByTestId('chart-goal-status')).toBeInTheDocument();
    expect(screen.getByTestId('chart-sheet-status')).toBeInTheDocument();
  });

  it('turns enum buckets into the words people use', async () => {
    serve({ '/cycles': CYCLES, '/analytics': ANALYTICS });

    render_(<AnalyticsPage />);

    const table = await screen.findByTestId('chart-thrust-table');
    expect(table).toHaveTextContent('Operational excellence');
    expect(table).not.toHaveTextContent('OPERATIONAL_EXCELLENCE');
  });

  it('states each share without making the reader divide', async () => {
    serve({ '/cycles': CYCLES, '/analytics': ANALYTICS });

    render_(<AnalyticsPage />);

    // 300 of 742 is 40%.
    const table = await screen.findByTestId('chart-thrust-table');
    expect(within(table).getByText('40%')).toBeInTheDocument();
  });

  it('never counts anything itself — the totals come from the server [F-13]', async () => {
    serve({
      '/cycles': CYCLES,
      // Deliberately inconsistent: the buckets do not add to the total.
      '/analytics': { ...ANALYTICS, totalGoals: 999 },
    });

    render_(<AnalyticsPage />);

    /*
     * If the page re-derived the total from the buckets it would print 742.
     * It prints what it was told, because the database is what counted — F-13
     * was that loop living in a serverless function, and moving it into the
     * browser would be the same mistake with every viewer paying it.
     */
    expect(await screen.findByTestId('analytics-totals')).toHaveTextContent('999');
  });

  it('says so when a cycle has nothing in it yet', async () => {
    serve({
      '/cycles': CYCLES,
      '/analytics': { ...ANALYTICS, byUom: [] },
    });

    render_(<AnalyticsPage />);

    expect(
      await within(await screen.findByTestId('chart-uom')).findByText(/Nothing to show/),
    ).toBeInTheDocument();
  });
});

describe('CalibrationPage [W6-14]', () => {
  const CALIBRATION = {
    cycleId: 'cyc1',
    scale: { min: 1, max: 5 },
    distribution: [
      { rating: 1, count: 2 },
      { rating: 2, count: 8 },
      { rating: 3, count: 40 },
      { rating: 4, count: 22 },
      { rating: 5, count: 0 },
    ],
    byManager: [
      { managerId: 'm1', managerName: 'Marcus', count: 40, mean: 3.1, outlier: false },
      { managerId: 'm2', managerName: 'Generous Greg', count: 32, mean: 4.4, outlier: true },
    ],
    orgMean: 3.3,
    divergences: [
      {
        appraisalId: 'a1',
        sheetId: 's1',
        userId: 'u1',
        userName: 'Priya',
        computedScore: 0.92,
        computedOnScale: 4.7,
        managerRating: 3,
        divergence: 1.7,
      },
    ],
    total: 72,
  };

  it('shows every point on the scale, including the ones nobody scored', async () => {
    serve({ '/cycles': CYCLES, '/calibration': CALIBRATION });

    render_(<CalibrationPage />);

    const table = await screen.findByTestId('rating-distribution-table');
    // A distribution with holes in it reads as missing data rather than zero.
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(table).toHaveTextContent('0%');
  });

  it('names an outlier manager in words rather than colouring the row', async () => {
    serve({ '/cycles': CYCLES, '/calibration': CALIBRATION });

    render_(<CalibrationPage />);

    const table = await screen.findByTestId('manager-table');
    const greg = within(table).getByText('Generous Greg').closest('tr');

    // "The reddish row" is not something you can put in a meeting invitation.
    expect(within(greg as HTMLElement).getByText('Outlier')).toBeInTheDocument();
    expect(within(greg as HTMLElement).getByText('+1.1')).toBeInTheDocument();
  });

  it('does not flag a manager sitting near the organization mean', async () => {
    serve({ '/cycles': CYCLES, '/calibration': CALIBRATION });

    render_(<CalibrationPage />);

    const table = await screen.findByTestId('manager-table');
    const marcus = within(table).getByText('Marcus').closest('tr');

    expect(within(marcus as HTMLElement).queryByText('Outlier')).not.toBeInTheDocument();
  });

  it('puts the computed score and the manager rating side by side [US-704]', async () => {
    serve({ '/cycles': CYCLES, '/calibration': CALIBRATION });

    render_(<CalibrationPage />);

    const table = await screen.findByTestId('divergence-table');
    // Both on the cycle's own scale, so the two numbers mean the same thing.
    expect(table).toHaveTextContent('4.7');
    expect(table).toHaveTextContent('3');
    expect(table).toHaveTextContent('1.7');
  });

  it('will not adjust a rating without a reason [US-802]', async () => {
    serve({ '/cycles': CYCLES, '/calibration': CALIBRATION });

    render_(<CalibrationPage />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Final rating for Priya'), '4');

    // The schema requires it and the service refuses without it; this is the
    // copy that tells somebody before they have moved on.
    expect(screen.getByRole('button', { name: 'Adjust' })).toBeDisabled();

    await user.type(screen.getByLabelText('Reason for Priya'), 'Goals were mis-set at the start.');
    expect(screen.getByRole('button', { name: 'Adjust' })).toBeEnabled();
  });

  it('sends the rating and the reason together', async () => {
    serve({ '/cycles': CYCLES, '/calibration': CALIBRATION });

    render_(<CalibrationPage />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Final rating for Priya'), '4');
    await user.type(screen.getByLabelText('Reason for Priya'), 'Goals were mis-set.');
    await user.click(screen.getByRole('button', { name: 'Adjust' }));

    await waitFor(() => {
      expect(lastBody('/calibration/adjust')).toEqual({
        appraisalId: 'a1',
        finalRating: 4,
        reason: 'Goals were mis-set.',
      });
    });
  });

  it('turns a refusal to release into the pre-release report [US-803]', async () => {
    fetchMock.mockImplementation((url: string) => {
      const path = String(url);

      if (path.includes('/calibration/release')) {
        return Promise.resolve(
          json(
            {
              error: 'Some appraisals have no final rating, so results cannot be released.',
              code: 'NOT_RATED',
              detail: ['Priya Sharma', 'Marcus Chen'],
            },
            422,
          ),
        );
      }
      if (path.includes('/calibration')) {
        return Promise.resolve(json(CALIBRATION));
      }
      return Promise.resolve(json(CYCLES));
    });

    render_(<CalibrationPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Lock and release' }));

    /*
     * The server already computes this list to decide it must refuse, so the
     * refusal *is* the report. A separate preview endpoint could only disagree
     * with the thing that actually decides.
     */
    const report = await screen.findByTestId('unreleased');
    expect(report).toHaveTextContent('Priya Sharma');
    expect(report).toHaveTextContent('Marcus Chen');
  });

  it('releases when everything is rated', async () => {
    serve({
      '/cycles': CYCLES,
      '/calibration/release': { released: 72 },
      '/calibration': CALIBRATION,
    });

    render_(<CalibrationPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Lock and release' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('/calibration/release')),
      ).toBe(true);
    });
    expect(screen.queryByTestId('unreleased')).not.toBeInTheDocument();
  });
});

describe('CompliancePage [W6-16]', () => {
  const SUMMARY = {
    cycleId: 'cyc1',
    totalUsers: 180,
    sheetsSubmitted: 142,
    sheetsApproved: 120,
    selfAppraisalsComplete: 60,
    managerRatingsComplete: 12,
    openEscalations: 2,
    byTier: { MANAGER: 1, SKIP_LEVEL_HR: 1 },
  };

  const escalation = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    cycleId: 'cyc1',
    subjectUserId: 'u1',
    subjectName: 'Priya Sharma',
    rule: 'GOALS_NOT_SUBMITTED',
    tier: 'MANAGER',
    status: 'ACTIVE',
    dueAt: '2026-04-10T00:00:00.000Z',
    notifiedAt: null,
    resolvedAt: null,
    resolutionNote: null,
    daysOverdue: 3,
    ...over,
  });

  const ESCALATIONS = { items: [escalation()], nextCursor: null };

  it('states each ratio as a percentage and as its fraction', async () => {
    serve({ '/cycles': CYCLES, '/compliance': SUMMARY, '/escalations': ESCALATIONS });

    render_(<CompliancePage />);

    // The prototype's key-value list made the reader do the division.
    const meter = await screen.findByTestId('meter-submitted');
    expect(meter).toHaveTextContent('79%');
    expect(meter).toHaveTextContent('142 of 180');
  });

  it('exposes each meter to assistive technology with its real value', async () => {
    serve({ '/cycles': CYCLES, '/compliance': SUMMARY, '/escalations': ESCALATIONS });

    render_(<CompliancePage />);

    await screen.findByTestId('meter-submitted');
    const meter = screen.getByRole('meter', { name: 'Sheets submitted' });

    expect(meter).toHaveAttribute('aria-valuenow', '79');
  });

  it('reports 0% rather than NaN on the first day of a cycle', async () => {
    serve({
      '/cycles': CYCLES,
      '/compliance': { ...SUMMARY, totalUsers: 0, sheetsSubmitted: 0 },
      '/escalations': ESCALATIONS,
    });

    render_(<CompliancePage />);

    const meter = await screen.findByTestId('meter-submitted');
    expect(meter).toHaveTextContent('0%');
    expect(meter).not.toHaveTextContent('NaN');
  });

  it('shows the real number of days late, with no floor [F-08]', async () => {
    serve({
      '/cycles': CYCLES,
      '/compliance': SUMMARY,
      '/escalations': { items: [escalation({ daysOverdue: 0 })], nextCursor: null },
    });

    render_(<CompliancePage />);

    const table = await screen.findByTestId('escalation-table');
    /*
     * The prototype floored this at four with `Math.max(elapsed, 4)`, so
     * something that became due an hour ago reported "4 days overdue" and
     * escalated accordingly. Zero is a legitimate answer.
     */
    expect(within(table).getByText('0')).toBeInTheDocument();
    expect(table).not.toHaveTextContent('4');
  });

  it('names the tier in words beside its colour', async () => {
    serve({ '/cycles': CYCLES, '/compliance': SUMMARY, '/escalations': ESCALATIONS });

    render_(<CompliancePage />);

    /*
     * Scoped to the table: the tier filter above it offers the same words, and
     * that is correct — a filter and a badge naming the same thing differently
     * is its own bug. The first version of this test searched the whole page
     * and matched both.
     */
    const table = await screen.findByTestId('escalation-table');

    // Two of the status steps sit below 3:1 on white by design; the label is
    // the mitigation, so colour never carries the meaning alone.
    expect(within(table).getByText('Escalated to the manager')).toBeInTheDocument();
  });

  it('will not resolve without a note [US-904]', async () => {
    serve({ '/cycles': CYCLES, '/compliance': SUMMARY, '/escalations': ESCALATIONS });

    render_(<CompliancePage />);
    const user = userEvent.setup();

    await screen.findByTestId('escalation-table');
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();

    await user.type(
      screen.getByLabelText('Resolution note for Priya Sharma'),
      'Spoke to them; sheet submitted today.',
    );
    await user.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      expect(lastBody('/resolve')).toEqual({ note: 'Spoke to them; sheet submitted today.' });
    });
  });

  it('filters the board without re-deriving it', async () => {
    serve({ '/cycles': CYCLES, '/compliance': SUMMARY, '/escalations': ESCALATIONS });

    render_(<CompliancePage />);
    const user = userEvent.setup();

    await screen.findByTestId('escalation-table');
    await user.selectOptions(screen.getByLabelText('Tier'), 'SKIP_LEVEL_HR');

    // The filter is a query parameter: the server decides what matches.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('tier=SKIP_LEVEL_HR')),
      ).toBe(true);
    });
  });

  it('shows the note instead of the form once resolved', async () => {
    serve({
      '/cycles': CYCLES,
      '/compliance': SUMMARY,
      '/escalations': {
        items: [
          escalation({
            status: 'RESOLVED',
            resolvedAt: '2026-04-12T00:00:00.000Z',
            resolutionNote: 'Sheet submitted late but submitted.',
          }),
        ],
        nextCursor: null,
      },
    });

    render_(<CompliancePage />);

    expect(await screen.findByText('Sheet submitted late but submitted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });

  it('says what resolving does and does not do', async () => {
    serve({ '/cycles': CYCLES, '/compliance': SUMMARY, '/escalations': ESCALATIONS });

    render_(<CompliancePage />);

    // Resolving is not a way to make a missed deadline permanently invisible.
    expect(await screen.findByText(/a new escalation is raised/)).toBeInTheDocument();
  });
});
