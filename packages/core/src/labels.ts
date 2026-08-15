/**
 * Plain-language names and explanations for the domain enums (W6-06).
 *
 * In `@aura/core` rather than in a component, so the words a form uses and the
 * words an email uses are the same words. A label duplicated in three screens
 * is three chances to describe the same rule differently.
 *
 * **`DIRECTION_EXPLANATIONS` is the point of this file.** The prototype
 * *inferred* a goal's direction by substring-matching its title —
 * `title.includes('tat' | 'cost' | 'reduction')` — so "Reduce customer wait
 * time" scored inversely by accident and "Rotation" flipped on the letters
 * t-a-t (PLAN.md F-06). Making the field required fixed the data model; the
 * remaining risk is a person picking the wrong one because the enum name means
 * nothing to them. Saying what each choice *does to the score* is what closes
 * that half.
 */

import type { GoalDirection, GoalStatus, Uom } from './scoring.js';

export const UOM_LABELS: Readonly<Record<Uom, string>> = {
  NUMERIC: 'Number',
  PERCENT: 'Percentage',
  TIMELINE: 'Milestone',
  ZERO_BASED: 'Count from zero',
};

/**
 * What each unit does when the goal is scored.
 *
 * `TIMELINE` is the one worth reading twice: it ignores target and actual
 * entirely and scores by status, so someone who types numbers into it will
 * find them silently unused.
 */
export const UOM_EXPLANATIONS: Readonly<Record<Uom, string>> = {
  NUMERIC: 'Scored by how close the actual figure gets to the target.',
  PERCENT: 'Scored by how close the actual percentage gets to the target.',
  TIMELINE: 'Scored by milestone status, not by the numbers — target and actual are not read.',
  ZERO_BASED: 'Scored against a target of zero, where any shortfall counts against you.',
};

export const DIRECTION_LABELS: Readonly<Record<GoalDirection, string>> = {
  HIGHER_IS_BETTER: 'Higher is better',
  LOWER_IS_BETTER: 'Lower is better',
};

/**
 * What choosing each direction does to the score, in the person's own terms.
 *
 * Written as a consequence rather than a definition. "Higher is better" is a
 * phrase someone can agree with while still picking it for a cost-reduction
 * goal; "exceeding the target scores above target" is a sentence they can
 * check against what they actually mean.
 */
export const DIRECTION_EXPLANATIONS: Readonly<Record<GoalDirection, string>> = {
  HIGHER_IS_BETTER:
    'Beating the target scores full marks; falling short scores less. Choose this for revenue, uptime, or satisfaction.',
  LOWER_IS_BETTER:
    'Coming in under the target scores full marks; going over scores less. Choose this for cost, defects, or wait time.',
};

export const GOAL_STATUS_LABELS: Readonly<Record<GoalStatus, string>> = {
  NOT_STARTED: 'Not started',
  ON_TRACK: 'On track',
  COMPLETED: 'Completed',
};

export const THRUST_AREA_LABELS: Readonly<Record<string, string>> = {
  BUSINESS_GROWTH: 'Business growth',
  OPERATIONAL_EXCELLENCE: 'Operational excellence',
  TECHNOLOGY_AND_INNOVATION: 'Technology and innovation',
  COMPLIANCE_AND_RISK: 'Compliance and risk',
};

export const SHEET_STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: 'Draft',
  PENDING: 'Awaiting approval',
  RETURNED: 'Returned for changes',
  APPROVED: 'Approved',
};

/** A label for a value, falling back to the value itself rather than to blank. */
export function labelFor(
  labels: Readonly<Record<string, string>>,
  value: string,
): string {
  // An unlabelled enum member should read as its raw name, which is ugly and
  // findable. An empty string is neither.
  return labels[value] ?? value;
}
