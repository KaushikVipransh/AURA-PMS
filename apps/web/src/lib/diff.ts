/**
 * Turning an audit row's before/after into something a person can read
 * (W6-17, PRD US-1102).
 *
 * The trail stores two JSON objects. Printing them side by side is what most
 * audit viewers do, and it is close to useless: an approval writes a dozen
 * fields of which two changed, and the reader has to play spot-the-difference
 * on `2026-04-11T09:31:02.117Z` versus `2026-04-11T09:31:02.118Z`.
 *
 * So this computes the difference and nothing else. **The server already sends
 * `changedFields`**, derived from the same two objects — this walks the values
 * to render them, and a field the server did not name is not invented here.
 *
 * Pure, so it is tested without rendering anything.
 */

export type FieldChange = {
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly kind: 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
};

/**
 * One value as a short string.
 *
 * Objects and arrays are shown as JSON rather than as `[object Object]`, which
 * is the single most common way a diff viewer becomes decorative. Long values
 * are left long: truncating the thing somebody opened the audit trail to read
 * would be an odd place to save space.
 */
export function present(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

/**
 * The fields that differ between two states of a record.
 *
 * A create has no `before` and every field reads as ADDED; a delete has no
 * `after` and every field reads as REMOVED. Both are true statements about
 * what the row records, and neither needs a special case.
 *
 * `UNCHANGED` is computed but only returned when asked for, because a field
 * present in both and equal is exactly the noise this function exists to
 * remove — it is available for the "show everything" toggle and nothing else.
 */
export function diffFields(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
  options: { includeUnchanged?: boolean } = {},
): FieldChange[] {
  const left = before ?? {};
  const right = after ?? {};
  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();

  return fields.flatMap((field): FieldChange[] => {
    const from = present(left[field]);
    const to = present(right[field]);

    if (from === to) {
      return options.includeUnchanged === true
        ? [{ field, from, to, kind: 'UNCHANGED' }]
        : [];
    }

    const kind: FieldChange['kind'] =
      from === null ? 'ADDED' : to === null ? 'REMOVED' : 'CHANGED';

    return [{ field, from, to, kind }];
  });
}

/**
 * A dotted action as a sentence.
 *
 * `goalsheet.approve` is precise and unreadable at a glance in a list of two
 * hundred. The mapping is exhaustive over the verbs the services actually
 * write; an unknown one falls back to the raw string rather than to a guess,
 * because a wrong sentence about an audit record is worse than a technical one.
 */
const ACTION_SENTENCES: Readonly<Record<string, string>> = {
  'user.invite': 'invited a user',
  'user.deactivate': 'deactivated a user',
  'user.import': 'imported users',
  'team.create': 'created a team',
  'cycle.create': 'created a cycle',
  'cycle.update': 'reconfigured a cycle',
  'cycle.activate': 'activated a cycle',
  'cycle.close': 'closed a cycle',
  'cycle.release': 'released results',
  'goalsheet.save': 'saved a draft',
  'goalsheet.submit': 'submitted a sheet',
  'goalsheet.approve': 'approved a sheet',
  'goalsheet.return': 'returned a sheet',
  'goalsheet.adjust': 'adjusted weightages',
  'goalsheet.checkin': 'recorded progress',
  'appraisal.self': 'wrote a self-appraisal',
  'appraisal.rate': 'rated a report',
  'appraisal.calibrate': 'adjusted a rating in calibration',
  'appraisal.acknowledge': 'acknowledged a rating',
  'sharedgoal.create': 'created a shared goal',
  'sharedgoal.cascade': 'cascaded a shared goal',
  'escalation.resolve': 'resolved an escalation',
  'comment.create': 'commented',
  'comment.update': 'edited a comment',
  'comment.delete': 'deleted a comment',
};

export function describeAction(action: string): string {
  return ACTION_SENTENCES[action] ?? action;
}

/** The distinct verbs, for a filter that offers what actually exists. */
export const AUDIT_ACTION_PREFIXES = [
  'user',
  'team',
  'cycle',
  'goalsheet',
  'appraisal',
  'sharedgoal',
  'escalation',
  'comment',
] as const;
