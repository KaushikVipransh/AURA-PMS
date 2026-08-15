import { describe, expect, it } from 'vitest';

import {
  DIRECTION_EXPLANATIONS,
  DIRECTION_LABELS,
  GOAL_STATUS_LABELS,
  UOM_EXPLANATIONS,
  UOM_LABELS,
  labelFor,
} from './labels.js';
import { GOAL_DIRECTIONS, GOAL_STATUSES, UOMS } from './scoring.js';

describe('labels cover every enum member', () => {
  /*
   * A missing label is a blank cell in a form, and blank cells are how a
   * required choice gets made by accident. These loops are what make adding an
   * enum member fail here rather than in production.
   */
  it.each(UOMS)('%s has a label and an explanation', (uom) => {
    expect(UOM_LABELS[uom].length).toBeGreaterThan(0);
    expect(UOM_EXPLANATIONS[uom].length).toBeGreaterThan(0);
  });

  it.each(GOAL_DIRECTIONS)('%s has a label and an explanation', (direction) => {
    expect(DIRECTION_LABELS[direction].length).toBeGreaterThan(0);
    expect(DIRECTION_EXPLANATIONS[direction].length).toBeGreaterThan(0);
  });

  it.each(GOAL_STATUSES)('%s has a label', (status) => {
    expect(GOAL_STATUS_LABELS[status].length).toBeGreaterThan(0);
  });
});

describe('the direction explanations [F-06]', () => {
  it('describe the effect on the score, not the words in the name', () => {
    /*
     * "Higher is better" is a phrase someone can agree with while still
     * picking it for a cost-reduction goal. The explanation has to say what it
     * does to the number.
     */
    expect(DIRECTION_EXPLANATIONS.HIGHER_IS_BETTER).toMatch(/scores/i);
    expect(DIRECTION_EXPLANATIONS.LOWER_IS_BETTER).toMatch(/scores/i);
  });

  it('name the kinds of goal each one suits', () => {
    // The prototype guessed this from the title and got "Reduce customer wait
    // time" backwards. Naming examples is what stops a person doing the same.
    expect(DIRECTION_EXPLANATIONS.LOWER_IS_BETTER).toMatch(/cost|defect|wait/i);
    expect(DIRECTION_EXPLANATIONS.HIGHER_IS_BETTER).toMatch(/revenue|uptime|satisfaction/i);
  });

  it('do not describe both directions the same way', () => {
    expect(DIRECTION_EXPLANATIONS.HIGHER_IS_BETTER).not.toBe(
      DIRECTION_EXPLANATIONS.LOWER_IS_BETTER,
    );
  });
});

describe('the unit explanations', () => {
  it('warn that a milestone goal ignores its numbers', () => {
    // Someone typing a target into a TIMELINE goal will find it silently
    // unused, which is exactly the kind of surprise a label can prevent.
    expect(UOM_EXPLANATIONS.TIMELINE).toMatch(/not read|ignored|status/i);
  });
});

describe('labelFor', () => {
  it('returns the label when there is one', () => {
    expect(labelFor(UOM_LABELS, 'PERCENT')).toBe('Percentage');
  });

  it('falls back to the raw value rather than to blank', () => {
    // Ugly and findable beats empty and invisible.
    expect(labelFor(UOM_LABELS, 'BRAND_NEW_UNIT')).toBe('BRAND_NEW_UNIT');
  });
});
