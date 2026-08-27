/**
 * What a cycle needs before it can be created (W6-12).
 *
 * Separate from the page so Fast Refresh keeps working and so the rules can be
 * tested without rendering a form. Each one is a restatement of something
 * `createCycleRequestSchema` also enforces — deliberately: the copy here exists
 * so somebody is told *before* they submit, and the schema's copy is the one
 * that decides. Where the same question has one implementation worth sharing
 * (phase overlaps), the page calls `findPhaseOverlaps` from `@aura/core`
 * directly rather than reimplementing it here.
 */

import { PHASE_KEYS, type PhaseKey } from '@aura/core';

export type PhaseDraft = {
  readonly key: PhaseKey;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
};

/** The five phases, laid end to end from `from`, as a starting point. */
export function defaultPhases(from: Date): PhaseDraft[] {
  const LENGTHS: Readonly<Record<PhaseKey, number>> = {
    GOAL_SETTING: 30,
    CHECK_IN: 180,
    APPRAISAL: 30,
    CALIBRATION: 14,
    RESULTS: 14,
  };

  let cursor = from.getTime();

  return PHASE_KEYS.map((key) => {
    const startsAt = new Date(cursor);
    // Half-open: this phase ends at the instant the next begins, which is
    // exactly the convention `activePhase` reads (W2-03) and therefore not an
    // overlap.
    const endsAt = new Date(cursor + LENGTHS[key] * 86_400_000);

    cursor = endsAt.getTime();

    return {
      key,
      label: key,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    };
  });
}

/**
 * A `<input type="date">` value as an instant, or `''` when it is empty.
 *
 * The naive `` `${value}T00:00:00.000Z` `` produces `"T00:00:00.000Z"` for an
 * emptied field — a string that parses to an Invalid Date and takes the whole
 * setup page down with a RangeError from `findPhaseOverlaps`, during render.
 * An empty field is empty; `cycleBlockers` is what says so.
 */
export function asInstant(value: string): string {
  return value === '' ? '' : `${value}T00:00:00.000Z`;
}

/** Whether both ends of a phase are real dates and can be compared. */
export function datedFully(phase: PhaseDraft): boolean {
  return (
    phase.startsAt !== '' &&
    phase.endsAt !== '' &&
    !Number.isNaN(new Date(phase.startsAt).getTime()) &&
    !Number.isNaN(new Date(phase.endsAt).getTime())
  );
}

/** `{ '1': 'Point 1', … }` for a scale, so every point starts labelled. */
export function scaleLabels(min: number, max: number): Record<string, string> {
  const labels: Record<string, string> = {};

  for (let point = min; point <= max; point += 1) {
    labels[String(point)] = `Point ${String(point)}`;
  }

  return labels;
}

export type CycleDraft = {
  readonly name: string;
  readonly phases: readonly PhaseDraft[];
  readonly labels: Readonly<Record<string, string>>;
  readonly min: number;
  readonly max: number;
};

/** Every reason this cycle cannot be created yet, in the order to fix them. */
export function cycleBlockers(draft: CycleDraft): readonly string[] {
  const reasons: string[] = [];

  if (draft.name.trim() === '') {
    reasons.push('Give the cycle a name.');
  }

  /* US-201: "a cycle cannot open without at least a goal-setting and an
     appraisal phase". Without goal setting nobody can write goals; without
     appraisal the cycle has no end anybody is measured at. */
  for (const key of ['GOAL_SETTING', 'APPRAISAL'] as const) {
    const phase = draft.phases.find((entry) => entry.key === key);

    if (phase === undefined || phase.startsAt === '' || phase.endsAt === '') {
      reasons.push(`${key === 'GOAL_SETTING' ? 'Goal setting' : 'Appraisal'} needs dates.`);
    }
  }

  for (const phase of draft.phases) {
    const started = phase.startsAt !== '';
    const ended = phase.endsAt !== '';

    /* A phase with one date and not the other is the state an emptied field
       leaves behind. It is not checked for overlap — it cannot be — so this is
       the only place anybody would hear about it. */
    if (started !== ended) {
      reasons.push(`${phase.key} needs both a start and an end, or neither.`);
      continue;
    }

    if (started && ended && !datedFully(phase)) {
      reasons.push(`${phase.key} has a date that cannot be read.`);
      continue;
    }

    if (
      started &&
      ended &&
      new Date(phase.startsAt).getTime() >= new Date(phase.endsAt).getTime()
    ) {
      reasons.push(`${phase.key} must end after it starts.`);
    }
  }

  if (draft.max <= draft.min) {
    reasons.push('The scale maximum must be above its minimum.');
  }

  const points = draft.max - draft.min + 1;
  const labelled = Object.values(draft.labels).filter((label) => label.trim() !== '').length;

  if (Object.keys(draft.labels).length !== points || labelled !== points) {
    // A rating of "4" that the cycle cannot name is a number, not a rating.
    reasons.push('Every point on the scale needs a label.');
  }

  return reasons;
}
