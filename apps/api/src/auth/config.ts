/**
 * Better Auth, configured.
 *
 * **Nothing outside `apps/api/src/auth/` may import this file or `better-auth`
 * itself.** W3-02 adds a lint rule enforcing that, and the reason is in
 * TECH_STACK.md §6: an auth library is the dependency most likely to need
 * replacing, and the cost of replacing it is decided now, by how many files
 * know its name. Today that number is one.
 *
 * ## Why core only, and no organization plugin
 *
 * The organization plugin was evaluated against the real schema in W3-01 and
 * rejected. It is a good plugin for a different shape of product:
 *
 *   - It models a role as a column on a `member` join table, so a user's
 *     permissions come from their membership. This schema puts `roles` on the
 *     user row, and W2-06's policy engine — 680 asserted cells — reads them
 *     from the actor. Adopting membership roles would mean rewriting that.
 *   - It makes `User` organization-less, with the link living in `member`.
 *     Tenancy here is a *database constraint*: `(managerId, orgId)` references
 *     `(id, orgId)`, so Postgres itself rejects a manager from another
 *     organization. That composite key needs `orgId` on the user row. Removing
 *     it would turn PLAN.md F-02 back into a convention.
 *   - It brings `team`/`teamMember` tables duplicating the `Team` model that
 *     W1-04 already built, with its own tenancy guarantee.
 *   - Its central feature is one user across many organizations. The PRD has
 *     no such case: one person, one organization (PRD E1).
 *
 * So Better Auth owns credentials and sessions. It does not own identity.
 */

import { prisma } from '@aura/db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

/**
 * Fail loudly and early rather than booting with a guessable secret.
 *
 * A missing signing secret does not break anything visibly — sessions still
 * issue, and they are simply forgeable. That is the worst failure mode a
 * configuration error can have, so it is checked at startup.
 */
function requireSecret(): string {
  const secret = process.env['BETTER_AUTH_SECRET'];

  if (secret === undefined || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be set to at least 32 characters. ' +
        'Generate one with `openssl rand -base64 32` and add it to .env — see .env.example.',
    );
  }

  return secret;
}

export const auth = betterAuth({
  secret: requireSecret(),
  baseURL: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:5000',

  /* The adapter takes our own lazily-constructed client rather than making its
     own. One connection pool, one place DATABASE_URL is read. */
  database: prismaAdapter(prisma, { provider: 'postgresql' }),

  emailAndPassword: {
    enabled: true,
    /* Length only. Composition rules push people toward `Password1!`, and the
       floor matches `passwordSchema` in @aura/contracts so the two cannot
       disagree about what is acceptable. */
    minPasswordLength: 12,
    maxPasswordLength: 200,
    /* Verification is wired in W3-04 alongside the reset flow, which needs the
       same mail transport. Until then an unverified user can still sign in --
       recorded here rather than left to be discovered. */
    requireEmailVerification: false,
  },

  session: {
    /* Seven days, refreshed when a request arrives inside the last day. Long
       enough that "stay signed in across browser restarts" (PRD US-102) is
       true, short enough that a stolen cookie expires on its own. */
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  advanced: {
    /* Our ids are cuid() everywhere; letting Better Auth generate its own
       format would make Session.id and User.id visibly different kinds of
       thing in the same database. */
    database: { generateId: false },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      /* Cross-site is not needed: the SPA and the API share a site in every
         deployment (TECH_STACK.md §11). `lax` gives CSRF protection for free. */
      secure: process.env['NODE_ENV'] === 'production',
    },
  },

  user: {
    /*
     * `orgId` must be supplied at sign-up: it is NOT NULL with no default,
     * because a user with no organization is exactly the shape F-02 allowed.
     * `input: true` is what lets the signup handler pass it.
     *
     * `roles` and `status` are deliberately absent from this list. They are
     * server-owned — a client that could name its own roles at sign-up would
     * make the whole of W2-06 decorative — so they take their Prisma defaults
     * (`[EMPLOYEE]`, `INVITED`) and are set by our own handlers in W3-03/W3-08.
     */
    additionalFields: {
      orgId: { type: 'string', required: true, input: true },
    },
  },
});

export type Auth = typeof auth;
