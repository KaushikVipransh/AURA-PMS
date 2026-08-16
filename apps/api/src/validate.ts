/**
 * Turning a request body into a parsed value, or into the error the client
 * gets back.
 *
 * The one place `@aura/contracts` meets the server. Wave 4's handlers call
 * `parseBody` rather than reading `req.body` directly, so "the request was
 * validated" is not something a reviewer has to check handler by handler.
 *
 * The prototype had the opposite arrangement: validation lived in the browser
 * and the server trusted the result, so a check-in request could write over an
 * approved sheet's targets and weightages (PLAN.md F-04).
 */

import { type ApiError } from '@aura/contracts';
import type { z } from 'zod';

export type ParseResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiError };

/**
 * Group Zod issues by the field they belong to.
 *
 * A form needs every message for a field at once. Returning only the first,
 * which is what a flat list amounts to, means the user fixes one problem per
 * round trip (PRD US-305).
 */
function fieldsFrom(issues: readonly z.core.$ZodIssue[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {};

  for (const issue of issues) {
    const key = issue.path.length === 0 ? '_' : issue.path.join('.');
    const existing = fields[key];

    if (existing === undefined) {
      fields[key] = [issue.message];
    } else {
      existing.push(issue.message);
    }
  }

  return fields;
}

/**
 * Parse an unknown payload against a contract schema.
 *
 * Returns a result rather than throwing: a failed parse is an ordinary 400,
 * not an exceptional condition, and handling it in the type system means a
 * handler cannot forget to.
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  payload: unknown,
): ParseResult<z.infer<T>> {
  const result = schema.safeParse(payload);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    error: {
      error: 'Validation failed',
      detail: 'The request body did not match the expected shape.',
      fields: fieldsFrom(result.error.issues),
    },
  };
}

/**
 * Turn one query-string value into the type a schema would expect of it.
 *
 * Everything in a query string is a string, so a schema asking for an integer
 * or a boolean rejects the very values it was written for. Two shapes are
 * coerced and nothing else is guessed at: a run of digits, and the two boolean
 * literals. An ISO instant stays a string because `instantSchema` parses one.
 */
function coerce(value: string): unknown {
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }

  return /^\d+$/.test(value) ? Number(value) : value;
}

/**
 * Parse a query string against a contract schema.
 *
 * Empty values are dropped rather than passed through, so `?status=` reads as
 * "no status given" and any default on the schema applies — passing `''` would
 * instead fail an enum and turn an empty filter box into a 400.
 *
 * Only keys the schema knows about survive its parse, which is the same
 * "unknown keys are dropped, never trusted" rule `parseBody` relies on (F-04).
 */
export function parseQuery<T extends z.ZodType>(
  schema: T,
  query: unknown,
): ParseResult<z.infer<T>> {
  const raw = (query ?? {}) as Record<string, string | undefined>;
  const coerced: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === '') {
      continue;
    }
    coerced[key] = coerce(value);
  }

  const result = schema.safeParse(coerced);

  if (result.success) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    error: {
      error: 'Validation failed',
      detail: 'The query string did not match the expected shape.',
      fields: fieldsFrom(result.error.issues),
    },
  };
}
