/**
 * Reading numbers out of the strings the database gives us.
 *
 * Prisma stores `target` and `actualAchievement` as text and serialises
 * `Decimal` weightages as strings, so almost every rule in this package starts
 * by turning a `string | number | null` into a number it can trust. Doing that
 * in one place is the point: the prototype's bugs were all coercion bugs
 * (`Number(x) || 1`, `Number(x) || 0`), and they were bugs precisely because
 * each call site coerced slightly differently.
 */

/**
 * The result of reading a number, kept in three states rather than two.
 *
 * *Absent* and *invalid* are not the same thing and must not collapse into one
 * value. A blank `actualAchievement` means nothing has been reported yet, which
 * is a legitimate mid-cycle state and scores 0. `'N/A'` means someone typed
 * text into a numeric field, which is a defect: no score is meaningful and the
 * caller should refuse rather than publish a number.
 */
export type ParsedNumber =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly value: number };

const ABSENT: ParsedNumber = { kind: 'absent' };
const INVALID: ParsedNumber = { kind: 'invalid' };

/**
 * Parse a database-shaped value into a finite number.
 *
 * `null`, `undefined` and whitespace-only strings are *absent*. Anything that
 * does not land on a finite number — text, `NaN`, `Infinity` — is *invalid*.
 *
 * The blank check runs before the conversion on purpose: `Number('')` is `0` in
 * JavaScript, and that single coercion is what let empty inputs look like
 * genuine zeroes throughout the prototype.
 */
export function parseNumeric(raw: string | number | null | undefined): ParsedNumber {
  if (raw == null) {
    return ABSENT;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { kind: 'ok', value: raw } : INVALID;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return ABSENT;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? { kind: 'ok', value } : INVALID;
}

/**
 * Round to a fixed number of decimal places.
 *
 * Used to settle binary-float residue before a comparison — summing
 * `33.34 + 33.33 + 33.33` yields `100.00000000000001`, which is not a real
 * discrepancy and must not be reported as one.
 */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
