/**
 * The live weightage meter (W6-06).
 *
 * Reads `validateWeightages` from `@aura/core` — the same function the Zod
 * schema calls and the same one the API enforces. The prototype had three
 * different answers to "do these add to 100": `Math.round(total) !== 100` in
 * one route, a strict `!== 100` in another, and a `>= 100` button guard in the
 * UI (PLAN.md F-10). A meter that computed its own total would be a fourth.
 *
 * **Every issue is listed, not just the first.** "Your weightages are invalid"
 * sends someone hunting; "Goal 2 is 5%, below the 10% minimum" tells them what
 * to type.
 */

import { WEIGHTAGE_TOTAL, validateWeightages, type WeightableGoal } from '@aura/core';

export function WeightageMeter({ goals }: { goals: readonly WeightableGoal[] }) {
  const validation = validateWeightages(goals);
  const total = validation.total;
  const remaining = Math.round((WEIGHTAGE_TOTAL - total) * 100) / 100;

  return (
    <section aria-labelledby="weightage-heading" className="rounded border p-4">
      <h2 id="weightage-heading" className="text-sm font-medium">
        Weightage
      </h2>

      <p className="mt-1 text-2xl font-semibold" data-testid="weightage-total">
        {total}%
        <span className="ml-2 text-sm font-normal text-slate-600">
          {remaining === 0
            ? 'exactly 100%'
            : remaining > 0
              ? `${String(remaining)}% left to allocate`
              : `${String(Math.abs(remaining))}% over`}
        </span>
      </p>

      <div
        role="progressbar"
        aria-valuenow={Math.min(total, WEIGHTAGE_TOTAL)}
        aria-valuemin={0}
        aria-valuemax={WEIGHTAGE_TOTAL}
        aria-labelledby="weightage-heading"
        className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-200"
      >
        <div
          className={total > WEIGHTAGE_TOTAL ? 'h-full bg-red-600' : 'h-full bg-slate-900'}
          style={{ width: `${String(Math.min((total / WEIGHTAGE_TOTAL) * 100, 100))}%` }}
        />
      </div>

      {validation.issues.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-red-700" data-testid="weightage-issues">
          {validation.issues.map((issue) => (
            <li key={`${issue.code}-${String(issue.goalIndex ?? 'sheet')}`}>{issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
