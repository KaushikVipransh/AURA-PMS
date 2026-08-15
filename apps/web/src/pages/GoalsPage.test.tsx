import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { submitBlockers } from '../lib/goal-rules.js';
import { createQueryClient } from '../lib/query.js';
import type { GoalDraft } from '../lib/sheets.js';
import { GoalsPage } from './GoalsPage.js';

/** W6-06 — the goal builder, and the F-06 and F-10 guards in it. */

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

const CYCLE = {
  id: 'cyc1',
  name: 'FY26',
  fiscalYear: 2026,
  status: 'ACTIVE',
  phases: [],
};

const goal = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'g1',
  thrustArea: 'BUSINESS_GROWTH',
  title: 'Grow ARR',
  uom: 'NUMERIC',
  direction: 'HIGHER_IS_BETTER',
  target: '100',
  weightage: 100,
  actualAchievement: null,
  status: 'NOT_STARTED',
  ...over,
});

/** Answer the two calls the page makes, in order. */
function serve(sheet: unknown): void {
  fetchMock.mockImplementation((url: string) => {
    if (String(url).includes('/cycles')) {
      return Promise.resolve(json({ cycles: [CYCLE] }));
    }
    if (sheet === null) {
      return Promise.resolve(json({ error: 'Not found' }, 404));
    }
    return Promise.resolve(json(sheet));
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <GoalsPage />
    </QueryClientProvider>,
  );
}

const draft = (over: Partial<GoalDraft> = {}): GoalDraft => ({
  thrustArea: 'BUSINESS_GROWTH',
  title: 'A goal',
  uom: 'NUMERIC',
  direction: 'HIGHER_IS_BETTER',
  target: '100',
  weightage: 34,
  ...over,
});

describe('submitBlockers [W6-06]', () => {
  it('lists every reason, not just the first', () => {
    // "Your sheet is invalid" sends someone hunting. The prototype's
    // `alert('Error')` did exactly that (F-14).
    const reasons = submitBlockers([draft({ title: '', target: '' })]);

    expect(reasons.length).toBeGreaterThan(2);
  });

  it('names the goal each reason belongs to', () => {
    const reasons = submitBlockers([draft(), draft({ title: '' }), draft()]);

    expect(reasons).toContain('Goal 2 needs a title.');
  });

  it('refuses a sheet with too few goals, saying how many there are', () => {
    expect(submitBlockers([draft({ weightage: 100 })])).toContain(
      'Add at least 3 goals — you have 1.',
    );
  });

  it('reports the weightage total through the shared validator [F-10]', () => {
    /*
     * Not a locally computed sum. The prototype had three different answers to
     * "do these add to 100" -- two server routes and a button guard -- and they
     * disagreed. `validateWeightages` is the only implementation.
     */
    const reasons = submitBlockers([draft({ weightage: 50 }), draft({ weightage: 30 }), draft({ weightage: 10 })]);

    expect(reasons.some((reason: string) => reason.includes('90'))).toBe(true);
  });

  it('passes a complete, balanced sheet', () => {
    const reasons = submitBlockers([
      draft({ weightage: 34 }),
      draft({ weightage: 33 }),
      draft({ weightage: 33 }),
    ]);

    expect(reasons).toEqual([]);
  });
});

describe('GoalsPage', () => {
  it('says so plainly when there is no open cycle', async () => {
    fetchMock.mockResolvedValue(json({ cycles: [] }));

    renderPage();

    expect(await screen.findByText(/no open review cycle/i)).toBeInTheDocument();
  });

  it('loads the existing goals into the form', async () => {
    serve({ sheet: { id: 's1', userId: 'u1', cycleId: 'cyc1', status: 'DRAFT', submittedAt: null, approvedAt: null, goals: [goal()] }, score: { score: 0, percent: 0 } });

    renderPage();

    expect(await screen.findByDisplayValue('Grow ARR')).toBeInTheDocument();
  });

  it('shows what each direction does to the score [F-06]', async () => {
    serve({ sheet: { id: 's1', userId: 'u1', cycleId: 'cyc1', status: 'DRAFT', submittedAt: null, approvedAt: null, goals: [goal()] }, score: { score: 0, percent: 0 } });

    renderPage();

    /*
     * The prototype inferred direction from the title by substring match, so
     * "Reduce customer wait time" scored inversely by accident. Making the
     * field required fixed the data; saying what each option *does* is what
     * stops a person picking the wrong one.
     */
    expect(await screen.findByText(/Beating the target scores full marks/i)).toBeInTheDocument();
    expect(screen.getByText(/Coming in under the target scores full marks/i)).toBeInTheDocument();
  });

  it('offers direction as radios, so both consequences are visible at once', async () => {
    serve({ sheet: { id: 's1', userId: 'u1', cycleId: 'cyc1', status: 'DRAFT', submittedAt: null, approvedAt: null, goals: [goal()] }, score: { score: 0, percent: 0 } });

    renderPage();

    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(2);
  });

  it('warns that a milestone goal ignores its numbers', async () => {
    serve({ sheet: { id: 's1', userId: 'u1', cycleId: 'cyc1', status: 'DRAFT', submittedAt: null, approvedAt: null, goals: [goal({ uom: 'TIMELINE' })] }, score: { score: 0, percent: 0 } });

    renderPage();

    // Someone typing a target into a TIMELINE goal finds it silently unused.
    expect(await screen.findByText(/not read/i)).toBeInTheDocument();
  });

  it('shows the live weightage total', async () => {
    serve({ sheet: { id: 's1', userId: 'u1', cycleId: 'cyc1', status: 'DRAFT', submittedAt: null, approvedAt: null, goals: [goal({ weightage: 40 })] }, score: { score: 0, percent: 0 } });

    renderPage();

    /*
     * Waits for the loaded form, not for the meter.
     *
     * The meter renders immediately at 0% while the sheet is still in flight,
     * so `findByTestId` resolves before the data arrives and asserts on the
     * empty state -- which is how this test failed the first time it ran.
     */
    await screen.findByDisplayValue('Grow ARR');

    expect(screen.getByTestId('weightage-total')).toHaveTextContent('40%');
  });

  it('updates the meter as a weightage is typed', async () => {
    serve({ sheet: { id: 's1', userId: 'u1', cycleId: 'cyc1', status: 'DRAFT', submittedAt: null, approvedAt: null, goals: [goal({ weightage: 40 })] }, score: { score: 0, percent: 0 } });

    renderPage();
    const user = userEvent.setup();

    const field = await screen.findByLabelText('Weightage %');
    await user.clear(field);
    await user.type(field, '55');

    expect(await screen.findByTestId('weightage-total')).toHaveTextContent('55%');
  });

  it('blocks submit and says why', async () => {
    serve({ sheet: { id: 's1', userId: 'u1', cycleId: 'cyc1', status: 'DRAFT', submittedAt: null, approvedAt: null, goals: [goal({ weightage: 40 })] }, score: { score: 0, percent: 0 } });

    renderPage();

    const blockers = await screen.findByTestId('submit-blockers');
    expect(within(blockers).getByText(/Add at least 3 goals/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit for approval/ })).toBeDisabled();
  });

  it('locks an approved sheet rather than letting it be edited', async () => {
    serve({ sheet: { id: 's1', userId: 'u1', cycleId: 'cyc1', status: 'APPROVED', submittedAt: null, approvedAt: null, goals: [goal()] }, score: { score: 0, percent: 0 } });

    renderPage();

    expect(await screen.findByDisplayValue('Grow ARR')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add a goal' })).not.toBeInTheDocument();
  });

  it('starts from an empty form when no sheet exists yet', async () => {
    serve(null);

    renderPage();
    const user = userEvent.setup();

    // A 404 is the honest answer for "you have not started one", not an error.
    await user.click(await screen.findByRole('button', { name: 'Add a goal' }));

    expect(screen.getByLabelText('Title')).toHaveValue('');
  });
});
