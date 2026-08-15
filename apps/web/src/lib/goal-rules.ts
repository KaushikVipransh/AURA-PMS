/**
 * Why a goal sheet cannot be submitted yet (W6-06).
 *
 * Separate from the page component so React Fast Refresh keeps working — a
 * module exporting both a component and a plain function forces a full reload
 * on every edit — and so the rules can be tested without rendering anything.
 */

import { MAX_GOALS_PER_SHEET, MIN_GOALS_PER_SHEET, validateWeightages } from '@aura/core';

import type { GoalDraft } from './sheets.js';

/** Every reason submit is blocked, in the order someone would fix them. */
export function submitBlockers(goals: readonly GoalDraft[]): readonly string[] {
  const reasons: string[] = [];

  if (goals.length < MIN_GOALS_PER_SHEET) {
    reasons.push(
      `Add at least ${String(MIN_GOALS_PER_SHEET)} goals — you have ${String(goals.length)}.`,
    );
  }
  if (goals.length > MAX_GOALS_PER_SHEET) {
    reasons.push(`Remove some goals — the limit is ${String(MAX_GOALS_PER_SHEET)}.`);
  }

  for (const [index, goal] of goals.entries()) {
    const position = index + 1;

    if (goal.title.trim() === '') {
      reasons.push(`Goal ${String(position)} needs a title.`);
    }
    if (goal.target.trim() === '') {
      reasons.push(`Goal ${String(position)} needs a target.`);
    }
  }

  /* The weightage rules are not restated. `validateWeightages` is the one
     implementation -- the same one the Zod schema and the API call -- and its
     messages already name the offending goal. The prototype had three
     disagreeing answers to this question (F-10). */
  reasons.push(
    ...validateWeightages(
      goals.map((goal, index) => ({
        title: goal.title || `Goal ${String(index + 1)}`,
        weightage: goal.weightage,
      })),
    ).issues.map((issue) => issue.message),
  );

  return reasons;
}
