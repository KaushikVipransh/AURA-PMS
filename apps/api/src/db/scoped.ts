/**
 * A database client that cannot see another organization's rows.
 *
 * `orgId` is taken from `req.actor` and **never** from a path parameter, a
 * query string or a body field. That is the whole point: a scope the caller can
 * name is a scope the caller can change, and `GET /users/:id` with an
 * attacker-supplied `orgId` is the prototype's `emp-123` problem wearing a
 * different hat (PLAN.md F-02).
 *
 * Implemented as a Prisma client extension rather than as a convention, so the
 * filter is applied by the query pipeline instead of by whoever wrote the
 * service. A `findMany` that forgets `where: { orgId }` still only sees its own
 * organization, because there is no code path that could have forgotten.
 */

import { prisma } from '@aura/db';

/**
 * Models carrying an `orgId` column, and therefore scoped automatically.
 *
 * Listed explicitly. Deriving it from the Prisma DMMF would be cleverer and
 * would silently include any future model that happens to have an `orgId` —
 * and silently *exclude* one whose tenancy travels through a parent. An
 * explicit list is a decision per model, which is what this deserves.
 */
export const ORG_SCOPED_MODELS = [
  'user',
  'team',
  'reviewCycle',
  'goalSheet',
  'sharedGoal',
  'auditEvent',
  'escalation',
  'notification',
] as const;

export type OrgScopedModel = (typeof ORG_SCOPED_MODELS)[number];

const SCOPED = new Set<string>(ORG_SCOPED_MODELS);

/**
 * Operations whose first argument carries a `where` we can narrow.
 *
 * `create` is deliberately absent: there is nothing to filter on the way in,
 * and a create carries its `orgId` in `data`. Callers pass `actor.orgId` there
 * explicitly, which stays visible at the call site rather than being injected
 * invisibly — a wrong `orgId` on a write is a corruption, not a leak, and it
 * should be something a reviewer can see.
 */
const FILTERED_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
  'update',
  'delete',
  'upsert',
]);

type QueryArgs = { where?: Record<string, unknown> } & Record<string, unknown>;

/**
 * A client scoped to one organization.
 *
 * Returned as its own value rather than mutating the singleton, because two
 * requests from two organizations are in flight at the same time and a mutable
 * global scope would be a race with tenant data as the prize.
 */
export function scopedPrisma(orgId: string) {
  if (orgId === '') {
    throw new Error('scopedPrisma requires an organization id.');
  }

  return prisma.$extends({
    name: 'org-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!SCOPED.has(uncapitalize(model)) || !FILTERED_OPERATIONS.has(operation)) {
            return query(args);
          }

          const typed = args as QueryArgs;

          /*
           * `orgId` is written LAST, so it always wins over anything the
           * caller put in `where` — including a deliberately crafted `orgId`.
           *
           * The first version wrapped this in `{ AND: [callerWhere, { orgId }] }`,
           * which reads more defensively and is wrong: `findUnique`, `update`
           * and `delete` require a unique selector in `where` and reject a
           * top-level `AND`, so every one of them answered 500. Prisma's
           * extended-where (GA since 5.0) accepts extra non-unique filters
           * alongside the unique field, which is what makes this form work for
           * unique and non-unique operations alike.
           *
           * Top-level keys are ANDed by Prisma anyway, so a caller's `OR` is
           * still constrained rather than widened.
           */
          return query({
            ...typed,
            where: { ...(typed.where ?? {}), orgId },
          });
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof scopedPrisma>;

function uncapitalize(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
