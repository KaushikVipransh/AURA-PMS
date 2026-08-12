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
