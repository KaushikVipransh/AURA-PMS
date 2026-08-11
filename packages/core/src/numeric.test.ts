import { describe, expect, it } from 'vitest';

import { parseNumeric, roundTo } from './numeric.js';

describe('parseNumeric · absent', () => {
  it.each([null, undefined, '', '   ', '\t\n'])('reads %o as absent', (input) => {
    expect(parseNumeric(input)).toEqual({ kind: 'absent' });
  });

  it('does not let a blank string become a zero', () => {
    // Number('') is 0. That coercion is the whole reason this function exists.
    expect(Number('')).toBe(0);
    expect(parseNumeric('')).toEqual({ kind: 'absent' });
  });
});

describe('parseNumeric · invalid', () => {
  it.each(['abc', 'N/A', '10%', '1,000', 'Infinity', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'reads %o as invalid',
    (input) => {
      expect(parseNumeric(input)).toEqual({ kind: 'invalid' });
    },
  );
});

describe('parseNumeric · ok', () => {
  it.each([
    [0, 0],
    [-5, -5],
    [3.14, 3.14],
    ['0', 0],
    ['42', 42],
    ['-7.5', -7.5],
    [' 99.95 ', 99.95],
    ['1e3', 1000],
  ])('reads %o as %s', (input, expected) => {
    expect(parseNumeric(input)).toEqual({ kind: 'ok', value: expected });
  });
});

describe('roundTo', () => {
  it('settles the float residue of adding decimals', () => {
    // A real weightage split, not a contrived one: 10 + 58.01 + 31.99 sums to
    // 99.999999999999985789 in IEEE 754. Displayed raw it looks like a broken
    // sheet, and a strict `!== 100` rejects it outright.
    const residue = 10 + 58.01 + 31.99;

    expect(residue).not.toBe(100);
    expect(roundTo(residue, 4)).toBe(100);
  });

  it.each([
    [1.005, 2, 1.0],
    [100, 0, 100],
    [0.123456, 4, 0.1235],
    [99.99999999999999, 4, 100],
  ])('rounds %s to %s places as %s', (value, places, expected) => {
    expect(roundTo(value, places)).toBe(expected);
  });

  it('is symmetric about zero, and does not promise exact half-way behaviour', () => {
    // 2.345 cannot be represented exactly, so `2.345 * 100` is
    // 234.50000000000003 and rounds up. Whether a "half" rounds up or down
    // depends on the bits, not on a rule. Nothing here should rely on it —
    // this documents the limit rather than pinning a value we cannot honour.
    expect(roundTo(2.345, 2)).toBe(2.35);
    expect(roundTo(-2.345, 2)).toBe(-2.35);
  });

  it('leaves a value that needs no rounding untouched', () => {
    expect(roundTo(50, 4)).toBe(50);
  });
});
