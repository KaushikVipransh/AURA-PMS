import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../lib/query.js';
import { AppraisalPage } from './AppraisalPage.js';
import { CheckInPage } from './CheckInPage.js';

/** W6-07, W6-08 — check-in and self-appraisal. */

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

const CYCLE = { id: 'cyc1', name: 'FY26', fiscalYear: 2026, status: 'ACTIVE', phases: [] };

const APPROVED_SHEET = {
  sheet: {
    id: 's1',
    userId: 'u1',
    cycleId: 'cyc1',
    status: 'APPROVED',
    submittedAt: null,
    approvedAt: '2026-05-01T00:00:00.000Z',
    goals: [
      {
        id: 'g1',
        thrustArea: 'BUSINESS_GROWTH',
        title: 'Grow ARR',
        uom: 'NUMERIC',
        direction: 'HIGHER_IS_BETTER',
        target: '100',
        weightage: 100,
        actualAchievement: '80',
        status: 'ON_TRACK',
      },
    ],
  },
  score: { score: 0.8, percent: 80 },
};

/** Route each call by URL, so a page can make them in any order. */
function serve(routes: Readonly<Record<string, unknown>>, missing: readonly string[] = []): void {
  fetchMock.mockImplementation((url: string) => {
    const path = String(url);

    for (const fragment of missing) {
      if (path.includes(fragment)) {
        return Promise.resolve(json({ error: 'Not found' }, 404));
      }
    }
    for (const [fragment, body] of Object.entries(routes)) {
      if (path.includes(fragment)) {
        return Promise.resolve(json(body));
      }
    }
    return Promise.resolve(json({ error: 'Unexpected call' }, 500));
  });
}

const render_ = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);

describe('CheckInPage [W6-07]', () => {
  it('refuses to record against a sheet that is not approved', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/sheets': { ...APPROVED_SHEET, sheet: { ...APPROVED_SHEET.sheet, status: 'DRAFT' } },
    });

    render_(<CheckInPage />);

    expect(await screen.findByText(/only be recorded against an approved sheet/i)).toBeInTheDocument();
  });

  it('shows the agreed target as text, not as an input [F-04]', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET });

    render_(<CheckInPage />);

    /*
     * The prototype's check-in route trusted the client's whole payload and
     * wrote it over an approved sheet, so a progress update could silently
     * rewrite targets and weightages. The server whitelists two columns; the
     * form makes that visible rather than merely true.
     */
    const target = await screen.findByTestId('target-g1');
    expect(target).toHaveTextContent('100');
    expect(target.tagName).toBe('DD');
  });

  it('offers exactly the two fields the server will accept', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET });

    render_(<CheckInPage />);

    await screen.findByTestId('target-g1');

    // One text input and one select, per goal. Nothing for target, weightage,
    // title, thrust area or direction.
    expect(screen.getByLabelText('Actual achievement')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Target$/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Weightage/)).not.toBeInTheDocument();
  });

  it('pre-fills what was already reported', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET });

    render_(<CheckInPage />);

    expect(await screen.findByLabelText('Actual achievement')).toHaveValue('80');
  });

  it('shows the server-computed score rather than working one out [F-07]', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET });

    render_(<CheckInPage />);

    // The prototype computed this in two JSX components, so the number an
    // employee saw and the number their manager saw could drift with a deploy.
    expect(await screen.findByTestId('sheet-score')).toHaveTextContent('80%');
  });

  it('sends only the whitelisted fields when submitted', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET });

    render_(<CheckInPage />);
    const user = userEvent.setup();

    await screen.findByLabelText('Actual achievement');
    await user.click(screen.getByRole('button', { name: 'Record progress' }));

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/check-in'));
    const body = JSON.parse(String((call?.[1] as { body?: string } | undefined)?.body)) as {
      updates: Record<string, unknown>[];
    };

    expect(Object.keys(body.updates[0] ?? {}).sort()).toEqual([
      'actualAchievement',
      'goalId',
      'status',
    ]);
  });
});

describe('AppraisalPage [W6-08]', () => {
  const APPRAISAL = {
    sheetId: 's1',
    scale: { min: 1, max: 5 },
    computedScore: 0.8,
    computedOnScale: 4.2,
    appraisal: null,
    goals: [
      {
        id: 'g1',
        title: 'Grow ARR',
        target: '100',
        actualAchievement: '80',
        weightage: 100,
        computedScore: 0.8,
        selfNarrative: null,
        managerRating: null,
        managerNarrative: null,
      },
    ],
  };

  it('is never a blank page: target, actual and score are already there', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET, '/appraisals': APPRAISAL });

    render_(<AppraisalPage />);

    /*
     * US-701's whole complaint is that a self-appraisal written from nothing
     * arrives late and thin. Everything the system already knows is filled in.
     */
    expect(await screen.findByTestId('target-g1')).toHaveTextContent('100');
    expect(screen.getByTestId('actual-g1')).toHaveTextContent('80');
    expect(screen.getByTestId('score-g1')).toHaveTextContent('80%');
  });

  it('states the computed score on the cycle scale as well as a percentage', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET, '/appraisals': APPRAISAL });

    render_(<AppraisalPage />);

    // 0.8 on a 1-5 scale is 4.2, and stating it that way is what makes it
    // comparable to the rating a manager will give.
    expect(await screen.findByText(/4\.2 on a 1–5 scale/)).toBeInTheDocument();
  });

  it('blocks submit until every goal has a reflection, naming each', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET, '/appraisals': APPRAISAL });

    render_(<AppraisalPage />);

    const blockers = await screen.findByTestId('appraisal-blockers');
    expect(blockers).toHaveTextContent('Grow ARR needs a reflection.');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('enables submit once the reflections and summary are written', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET, '/appraisals': APPRAISAL });

    render_(<AppraisalPage />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/What happened/), 'Landed two large accounts.');
    await user.type(screen.getByLabelText('Overall summary'), 'A steady year.');

    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('locks a submitted appraisal and says why', async () => {
    serve({
      '/cycles': { cycles: [CYCLE] },
      '/sheets': APPROVED_SHEET,
      '/appraisals': {
        ...APPRAISAL,
        appraisal: {
          selfNarrative: 'Said my piece.',
          selfRating: null,
          selfSubmittedAt: '2026-06-01T00:00:00.000Z',
          managerRating: null,
          finalRating: null,
          releasedAt: null,
        },
      },
    });

    render_(<AppraisalPage />);

    /*
     * Waits for a field that only exists once loaded, then asserts.
     *
     * `findByRole('status')` alone matched the loading indicator, which also
     * carries `role="status"` -- so the first version of this test asserted
     * against the word "Loading…". Both uses are correct; the test simply has
     * to wait for the one it means.
     */
    const summary = await screen.findByLabelText('Overall summary');

    // Locked so the manager rates against what was actually written, rather
    // than against something edited after they started reading.
    expect(screen.getByRole('status')).toHaveTextContent(/locked/i);
    expect(summary).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('explains itself when the sheet is not approved yet', async () => {
    serve({ '/cycles': { cycles: [CYCLE] }, '/sheets': APPROVED_SHEET }, ['/appraisals']);

    render_(<AppraisalPage />);

    expect(await screen.findByText(/opens once your goal sheet has been approved/i)).toBeInTheDocument();
  });
});
