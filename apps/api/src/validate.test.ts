import { goalSheetInputSchema, loginRequestSchema } from '@aura/contracts';
import { describe, expect, it } from 'vitest';

import { parseBody } from './validate.js';

const CYCLE_ID = 'clw0000000000000000000000';

describe('parseBody', () => {
  it('returns the parsed value on success, with the schema transforms applied', () => {
    const result = parseBody(loginRequestSchema, { email: 'A@B.COM', password: 'hunter2' });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.email : null).toBe('a@b.com');
  });

  it('returns an error rather than throwing, because a bad body is an ordinary 400', () => {
    const result = parseBody(loginRequestSchema, { email: 'nope' });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.error).toBe('Validation failed');
  });

  it('groups every message under the field it belongs to', () => {
    const result = parseBody(loginRequestSchema, { email: 'nope', password: '' });
    const fields = result.ok ? {} : (result.error.fields ?? {});

    expect(Object.keys(fields).sort()).toEqual(['email', 'password']);
    expect(fields['email']?.length).toBeGreaterThan(0);
  });

  it('collects several messages for one field instead of reporting only the first', () => {
    const result = parseBody(goalSheetInputSchema, {
      cycleId: CYCLE_ID,
      goals: [
        {
          thrustArea: 'OPERATIONAL_EXCELLENCE',
          title: 'A',
          uom: 'PERCENT',
          direction: 'HIGHER_IS_BETTER',
          target: '1',
          weightage: 5,
        },
        {
          thrustArea: 'OPERATIONAL_EXCELLENCE',
          title: 'B',
          uom: 'PERCENT',
          direction: 'HIGHER_IS_BETTER',
          target: '1',
          weightage: 5,
        },
        {
          thrustArea: 'OPERATIONAL_EXCELLENCE',
          title: 'C',
          uom: 'PERCENT',
          direction: 'HIGHER_IS_BETTER',
          target: '1',
          weightage: 5,
        },
      ],
    });
    const fields = result.ok ? {} : (result.error.fields ?? {});

    // Three goals under the minimum weightage and a total of 15, so the client
    // sees all four problems on one round trip.
    expect(result.ok).toBe(false);
    expect(Object.keys(fields)).toContain('goals.0.weightage');
    expect(Object.keys(fields)).toContain('goals');
  });

  it('keeps both messages when one field breaks two rules', () => {
    // -1.005 is below zero and carries three decimals, so weightageSchema
    // fails twice on the same path. A field that reports one of its two
    // problems sends the user round the loop again for the second.
    const result = parseBody(goalSheetInputSchema, {
      cycleId: CYCLE_ID,
      goals: [
        {
          thrustArea: 'OPERATIONAL_EXCELLENCE',
          title: 'A',
          uom: 'PERCENT',
          direction: 'HIGHER_IS_BETTER',
          target: '1',
          weightage: -1.005,
        },
      ],
    });
    const fields = result.ok ? {} : (result.error.fields ?? {});

    expect(fields['goals.0.weightage']?.length).toBeGreaterThanOrEqual(2);
  });

  it('files an issue with no path under a placeholder rather than dropping it', () => {
    const result = parseBody(loginRequestSchema, 'not an object at all');
    const fields = result.ok ? {} : (result.error.fields ?? {});

    expect(Object.keys(fields)).toEqual(['_']);
  });

  it('produces an error matching the shared ApiError contract', () => {
    const result = parseBody(loginRequestSchema, {});

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toMatchObject({
      error: expect.any(String) as unknown,
      detail: expect.any(String) as unknown,
    });
  });
});
