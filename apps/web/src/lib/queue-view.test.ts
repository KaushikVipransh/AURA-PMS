import { describe, expect, it } from 'vitest';

import type { QueueItem } from './manager.js';
import { applyFilter, applySort, waitingOn } from './queue-view.js';

/** W6-09 — filtering, sorting and describing a queue row. */

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  sheetId: 's1',
  userId: 'u1',
  userName: 'Priya',
  status: 'PENDING',
  submittedAt: null,
  goalCount: 3,
  score: 0.8,
  selfAppraisalSubmitted: false,
  rated: false,
  actions: ['APPROVE', 'RETURN'],
  dueAt: null,
  daysOverdue: 0,
  ...over,
});

describe('applyFilter', () => {
  const rows = [
    item({ sheetId: 'a', userName: 'Ann', actions: ['APPROVE'] }),
    item({ sheetId: 'b', userName: 'Bo', status: 'APPROVED', actions: [] }),
    item({ sheetId: 'c', userName: 'Cy', status: 'APPROVED', actions: ['RATE'] }),
  ];

  it('shows what the caller can act on, whatever the status', () => {
    // Bo's sheet is approved and finished; Cy's is approved and waiting for a
    // rating. Status alone cannot tell those apart, which is why the filter
    // reads `actions` — the server's answer — instead.
    expect(applyFilter(rows, 'AWAITING').map((row) => row.sheetId)).toEqual(['a', 'c']);
  });

  it('filters by status when asked for a status', () => {
    expect(applyFilter(rows, 'PENDING').map((row) => row.sheetId)).toEqual(['a']);
    expect(applyFilter(rows, 'APPROVED').map((row) => row.sheetId)).toEqual(['b', 'c']);
  });

  it('leaves everything alone for ALL', () => {
    expect(applyFilter(rows, 'ALL')).toHaveLength(3);
  });
});

describe('applySort', () => {
  const rows = [item({ userName: 'Zoe' }), item({ userName: 'Ann' })];

  it('keeps the server’s order for urgency', () => {
    // Urgency is computed against phase deadlines the browser does not have,
    // so re-ranking here could only make it wrong.
    expect(applySort(rows, 'URGENCY').map((row) => row.userName)).toEqual(['Zoe', 'Ann']);
  });

  it('sorts by name without mutating the input', () => {
    expect(applySort(rows, 'NAME').map((row) => row.userName)).toEqual(['Ann', 'Zoe']);
    expect(rows[0]?.userName).toBe('Zoe');
  });
});

describe('waitingOn', () => {
  it('names the action the row actually offers', () => {
    expect(waitingOn(item({ actions: ['APPROVE'] }))).toMatch(/approval/i);
    expect(waitingOn(item({ actions: ['RATE'] }))).toMatch(/rating/i);
  });

  it('says whose turn it is when it is not the manager’s', () => {
    expect(
      waitingOn(item({ status: 'APPROVED', actions: [], selfAppraisalSubmitted: false })),
    ).toMatch(/self-appraisal/i);
    expect(waitingOn(item({ status: 'DRAFT', actions: [] }))).toMatch(/draft/i);
    expect(
      waitingOn(item({ status: 'APPROVED', actions: [], selfAppraisalSubmitted: true, rated: true })),
    ).toBe('Rated');
  });

  it('falls back to nothing outstanding', () => {
    expect(
      waitingOn(item({ status: 'PENDING', actions: [], selfAppraisalSubmitted: true })),
    ).toBe('Nothing outstanding');
  });
});
