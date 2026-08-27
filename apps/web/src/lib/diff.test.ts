import { describe, expect, it } from 'vitest';

import { describeAction, diffFields, present } from './diff.js';

/** W6-17 — the audit diff (PRD US-1102). */

describe('present', () => {
  it('leaves a string alone and stringifies a number or a boolean', () => {
    expect(present('APPROVED')).toBe('APPROVED');
    expect(present(40)).toBe('40');
    expect(present(false)).toBe('false');
  });

  it('reads null and undefined as absent, which is not the string "null"', () => {
    expect(present(null)).toBeNull();
    expect(present(undefined)).toBeNull();
  });

  it('renders an object as JSON rather than as [object Object]', () => {
    // The single most common way a diff viewer becomes decorative.
    expect(present({ min: 1, max: 5 })).toBe('{"min":1,"max":5}');
    expect(present(['a', 'b'])).toBe('["a","b"]');
  });
});

describe('diffFields', () => {
  it('reports only the fields that actually changed', () => {
    const changes = diffFields(
      { status: 'PENDING', userId: 'u1', updatedAt: '2026-04-11T09:31:02.117Z' },
      { status: 'APPROVED', userId: 'u1', updatedAt: '2026-04-11T09:31:02.118Z' },
    );

    /*
     * `userId` is identical and drops out. `updatedAt` differs and stays — it
     * really did change. The point is that `status` is not buried among a
     * dozen unchanged fields.
     */
    expect(changes.map((change) => change.field)).toEqual(['status', 'updatedAt']);
    expect(changes[0]).toMatchObject({ from: 'PENDING', to: 'APPROVED', kind: 'CHANGED' });
  });

  it('reads a create as every field added', () => {
    const changes = diffFields(null, { status: 'DRAFT', userId: 'u1' });

    expect(changes.every((change) => change.kind === 'ADDED')).toBe(true);
    expect(changes[0]?.from).toBeNull();
  });

  it('reads a delete as every field removed', () => {
    const changes = diffFields({ status: 'DRAFT' }, null);

    expect(changes[0]).toMatchObject({ kind: 'REMOVED', to: null });
  });

  it('distinguishes a field being set from a field being cleared', () => {
    const changes = diffFields(
      { approverId: null, note: 'keep' },
      { approverId: 'u9', note: null },
    );

    expect(changes.find((change) => change.field === 'approverId')?.kind).toBe('ADDED');
    expect(changes.find((change) => change.field === 'note')?.kind).toBe('REMOVED');
  });

  it('returns nothing for two identical states', () => {
    expect(diffFields({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('offers the unchanged fields only when asked', () => {
    const changes = diffFields({ a: 1, b: 2 }, { a: 1, b: 3 }, { includeUnchanged: true });

    expect(changes).toHaveLength(2);
    expect(changes.find((change) => change.field === 'a')?.kind).toBe('UNCHANGED');
  });

  it('sorts fields, so the same change always reads the same way', () => {
    const changes = diffFields({ zeta: 1, alpha: 1 }, { zeta: 2, alpha: 2 });

    expect(changes.map((change) => change.field)).toEqual(['alpha', 'zeta']);
  });

  it('handles both sides being absent', () => {
    expect(diffFields(null, null)).toEqual([]);
  });
});

describe('describeAction', () => {
  it('turns a dotted verb into a sentence', () => {
    expect(describeAction('goalsheet.approve')).toBe('approved a sheet');
    expect(describeAction('appraisal.calibrate')).toBe('adjusted a rating in calibration');
  });

  it('falls back to the raw action rather than guessing', () => {
    // A wrong sentence about an audit record is worse than a technical one.
    expect(describeAction('something.new')).toBe('something.new');
  });
});
