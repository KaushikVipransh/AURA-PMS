import { describe, expect, it } from 'vitest';

import { planImport, type ExistingOrg, type ImportRow } from './userImport.js';

/**
 * W6-13 — the import planner (PRD US-205, closes F-25).
 *
 * Unit tests rather than integration ones, because `planImport` is pure: it is
 * handed the rows and what the organization already holds, and the whole point
 * of splitting it out is that the preview and the commit ask the same function
 * the same question. A database adds nothing to that.
 */

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  name: 'Priya Sharma',
  email: 'priya@example.com',
  role: 'EMPLOYEE',
  managerEmail: null,
  teamName: null,
  ...over,
});

const org = (over: Partial<ExistingOrg> = {}): ExistingOrg => ({
  users: [],
  teams: [],
  ...over,
});

const messages = (plan: { errors: readonly { message: string }[] }): string =>
  plan.errors.map((error) => error.message).join(' | ');

describe('planImport · one row at a time', () => {
  it('plans a create for a clean row', () => {
    const plan = planImport([row()], org());

    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({ row: 1, email: 'priya@example.com', managerId: null });
  });

  it('skips somebody who is already registered rather than failing the file', () => {
    const plan = planImport(
      [row(), row({ email: 'new@example.com' })],
      org({ users: [{ id: 'u1', email: 'priya@example.com' }] }),
    );

    // Re-importing last month's roster with twenty new people in it is the
    // normal way this gets used.
    expect(plan.skipped.map((skip) => skip.email)).toEqual(['priya@example.com']);
    expect(plan.creates.map((create) => create.email)).toEqual(['new@example.com']);
    expect(plan.errors).toEqual([]);
  });

  it('matches an existing address case-insensitively', () => {
    const plan = planImport(
      [row({ email: 'Priya@Example.COM' })],
      org({ users: [{ id: 'u1', email: 'priya@example.com' }] }),
    );

    // The unique index is case-sensitive, so a plan that missed this would
    // create a row the database then refuses — mid-transaction, for everyone.
    expect(plan.skipped).toHaveLength(1);
    expect(plan.creates).toEqual([]);
  });

  it('errors the later of two rows sharing an address, naming the earlier', () => {
    const plan = planImport([row(), row({ name: 'Priya S' })], org());

    expect(plan.creates).toHaveLength(1);
    expect(plan.errors[0]).toMatchObject({ row: 2 });
    expect(messages(plan)).toContain('row 1');
  });

  it('refuses a team it would have to invent', () => {
    const plan = planImport([row({ teamName: 'Platform' })], org());

    expect(messages(plan)).toContain('no team called "Platform"');
  });

  it('resolves a team by name, ignoring case', () => {
    const plan = planImport(
      [row({ teamName: 'platform' })],
      org({ teams: [{ id: 't1', name: 'Platform' }] }),
    );

    expect(plan.creates[0]?.teamId).toBe('t1');
  });

  it('refuses somebody who manages themselves', () => {
    const plan = planImport([row({ managerEmail: 'priya@example.com' })], org());

    expect(messages(plan)).toContain('their own manager');
  });
});

describe('planImport · references between rows', () => {
  it('resolves a manager who already exists', () => {
    const plan = planImport(
      [row({ managerEmail: 'marcus@example.com' })],
      org({ users: [{ id: 'm1', email: 'marcus@example.com' }] }),
    );

    expect(plan.creates[0]).toMatchObject({ managerId: 'm1', managerEmail: null });
  });

  it('resolves a manager who appears later in the same file', () => {
    const plan = planImport(
      [
        row({ email: 'priya@example.com', managerEmail: 'marcus@example.com' }),
        row({ email: 'marcus@example.com', name: 'Marcus', role: 'MANAGER' }),
      ],
      org(),
    );

    // The person building the spreadsheet has no ids and no reason to sort it.
    expect(plan.errors).toEqual([]);
    expect(plan.creates[0]).toMatchObject({ managerId: null, managerEmail: 'marcus@example.com' });
  });

  it('errors a row whose manager is nowhere at all', () => {
    const plan = planImport([row({ managerEmail: 'ghost@example.com' })], org());

    expect(messages(plan)).toContain('No user with the email ghost@example.com');
  });

  it('errors a row whose manager is in the file but could not be imported', () => {
    const plan = planImport(
      [
        row({ email: 'priya@example.com', managerEmail: 'marcus@example.com' }),
        row({ email: 'marcus@example.com', teamName: 'Nowhere' }),
      ],
      org(),
    );

    expect(plan.creates).toEqual([]);
    // Two different things to fix, so two different sentences.
    expect(messages(plan)).toContain('no team called "Nowhere"');
    expect(messages(plan)).toContain('could not be imported');
  });

  it('cascades a failure down a whole branch, not just one level', () => {
    const plan = planImport(
      [
        row({ email: 'a@example.com', teamName: 'Nowhere' }),
        row({ email: 'b@example.com', managerEmail: 'a@example.com' }),
        row({ email: 'c@example.com', managerEmail: 'b@example.com' }),
        row({ email: 'd@example.com', managerEmail: 'c@example.com' }),
      ],
      org(),
    );

    /*
     * The acceptance criterion is "partial import never leaves a broken org
     * chart". One pass would have created c and d pointing at a manager who
     * was never written.
     */
    expect(plan.creates).toEqual([]);
    expect(plan.errors.map((error) => error.row)).toEqual([1, 2, 3, 4]);
  });

  it('leaves an unaffected branch alone while a broken one fails', () => {
    const plan = planImport(
      [
        row({ email: 'bad@example.com', teamName: 'Nowhere' }),
        row({ email: 'under-bad@example.com', managerEmail: 'bad@example.com' }),
        row({ email: 'boss@example.com' }),
        row({ email: 'under-boss@example.com', managerEmail: 'boss@example.com' }),
      ],
      org(),
    );

    // Partial success is the point: a typo in one department should not stop
    // another department being onboarded.
    expect(plan.creates.map((create) => create.email)).toEqual([
      'boss@example.com',
      'under-boss@example.com',
    ]);
    expect(plan.errors.map((error) => error.row)).toEqual([1, 2]);
  });
});

describe('planImport · loops', () => {
  it('refuses two people who manage each other', () => {
    const plan = planImport(
      [
        row({ email: 'a@example.com', managerEmail: 'b@example.com' }),
        row({ email: 'b@example.com', managerEmail: 'a@example.com' }),
      ],
      org(),
    );

    // Nothing in the schema forbids this. The recursive walks survive it
    // because they carry a visited set, but the chart would be nonsense.
    expect(plan.creates).toEqual([]);
    expect(messages(plan)).toContain('manage each other in a loop');
  });

  it('refuses a longer circle', () => {
    const plan = planImport(
      [
        row({ email: 'a@example.com', managerEmail: 'c@example.com' }),
        row({ email: 'b@example.com', managerEmail: 'a@example.com' }),
        row({ email: 'c@example.com', managerEmail: 'b@example.com' }),
      ],
      org(),
    );

    expect(plan.errors).toHaveLength(3);
  });

  it('refuses somebody hanging off a circle', () => {
    const plan = planImport(
      [
        row({ email: 'a@example.com', managerEmail: 'b@example.com' }),
        row({ email: 'b@example.com', managerEmail: 'a@example.com' }),
        row({ email: 'c@example.com', managerEmail: 'a@example.com' }),
      ],
      org(),
    );

    // c is not in the loop, but its chain never reaches anybody real.
    expect(plan.creates).toEqual([]);
    expect(plan.errors).toHaveLength(3);
  });

  it('accepts a deep chain that reaches somebody real', () => {
    const plan = planImport(
      [
        row({ email: 'd@example.com', managerEmail: 'c@example.com' }),
        row({ email: 'c@example.com', managerEmail: 'b@example.com' }),
        row({ email: 'b@example.com', managerEmail: 'a@example.com' }),
        row({ email: 'a@example.com', managerEmail: 'top@example.com' }),
      ],
      org({ users: [{ id: 'top', email: 'top@example.com' }] }),
    );

    expect(plan.errors).toEqual([]);
    expect(plan.creates).toHaveLength(4);
  });
});

describe('planImport · the shape of the answer', () => {
  it('reports rows in file order, whatever order they failed in', () => {
    const plan = planImport(
      [
        row({ email: 'a@example.com', managerEmail: 'b@example.com' }),
        row({ email: 'b@example.com', teamName: 'Nowhere' }),
        row({ email: 'c@example.com', teamName: 'Nowhere' }),
      ],
      org(),
    );

    // Somebody is reading this next to a spreadsheet.
    expect(plan.errors.map((error) => error.row)).toEqual([1, 2, 3]);
  });

  it('handles an empty organization and a single unattached row', () => {
    const plan = planImport([row({ managerEmail: null })], org());

    expect(plan).toMatchObject({ errors: [], skipped: [] });
    expect(plan.creates).toHaveLength(1);
  });
});
