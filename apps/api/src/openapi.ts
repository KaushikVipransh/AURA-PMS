/**
 * The OpenAPI document, generated from the Zod contracts (W4-21).
 *
 * **Generated, not written.** A handwritten API document is a second
 * description of the system that drifts from the first one silently, and the
 * drift is only discovered by a client that trusted it. Every request body
 * below is the same `@aura/contracts` schema the route parses with, so the
 * document cannot describe a payload the server would reject.
 *
 * The table is declarative and the gate on it is in
 * `openapi.integration.test.ts`: **a route with no entry here fails the
 * build**, and so does a mutating route that names no request schema. That is
 * the same shape as W3-09's permission matrix, and for the same reason — a
 * document that goes stale quietly is worse than no document, because people
 * act on it.
 */

import {
  acknowledgeRatingRequestSchema,
  activateCycleRequestSchema,
  adjustWeightageRequestSchema,
  analyticsQuerySchema,
  approveSheetRequestSchema,
  calibrationAdjustmentRequestSchema,
  checkInRequestSchema,
  createCommentRequestSchema,
  createCycleRequestSchema,
  createSharedGoalRequestSchema,
  createTeamRequestSchema,
  forgotPasswordRequestSchema,
  importUsersRequestSchema,
  inviteUserRequestSchema,
  listAuditQuerySchema,
  listCommentsQuerySchema,
  listEscalationsQuerySchema,
  listSheetsQuerySchema,
  listUsersQuerySchema,
  loginRequestSchema,
  managerRatingRequestSchema,
  orgChartQuerySchema,
  releaseResultsRequestSchema,
  resolveEscalationRequestSchema,
  resetPasswordRequestSchema,
  returnSheetRequestSchema,
  saveDraftRequestSchema,
  selfAppraisalRequestSchema,
  signupRequestSchema,
  updateCommentRequestSchema,
  updateCycleRequestSchema,
} from '@aura/contracts';
import { z } from 'zod';
import { createDocument } from 'zod-openapi';

export type RouteDoc = {
  readonly summary: string;
  readonly tag: string;
  /** The contract schema the route parses its body with. */
  readonly body?: z.ZodType;
  /** The contract schema its query string is parsed with. */
  readonly query?: z.ZodType;
};

/** Methods that carry a body, and so must name the schema that validates it. */
export const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * Routes deliberately absent from the document.
 *
 * Each is either not part of the product's API surface or is owned by a
 * library that documents itself. Listed rather than pattern-matched, so
 * adding one is a decision somebody made on purpose.
 */
export const UNDOCUMENTED: Readonly<Record<string, string>> = {
  'GET /healthz': 'Liveness probe. Not part of the product API.',
  'GET /openapi.json': 'The document itself; describing it inside itself adds nothing.',
  'GET /docs': 'The rendering of the document, not an endpoint.',
  'GET /api/auth/*splat': 'Better Auth owns this surface and publishes its own reference.',
  'POST /api/auth/*splat': 'Better Auth owns this surface and publishes its own reference.',
  'PUT /api/auth/*splat': 'Better Auth owns this surface and publishes its own reference.',
  'PATCH /api/auth/*splat': 'Better Auth owns this surface and publishes its own reference.',
  'DELETE /api/auth/*splat': 'Better Auth owns this surface and publishes its own reference.',
};

/** Every documented route, keyed exactly as `listRoutes` keys them. */
export const ROUTE_DOCS: Readonly<Record<string, RouteDoc>> = {
  'POST /auth/signup': {
    summary: 'Create an organization and its first account',
    tag: 'Auth',
    body: signupRequestSchema,
  },
  'POST /auth/login': { summary: 'Start a session', tag: 'Auth', body: loginRequestSchema },
  'POST /auth/logout': { summary: 'End the current session', tag: 'Auth', body: z.object({}) },
  'POST /auth/forgot': {
    summary: 'Request a password reset link',
    tag: 'Auth',
    body: forgotPasswordRequestSchema,
  },
  'POST /auth/reset': {
    summary: 'Set a new password from an emailed token',
    tag: 'Auth',
    body: resetPasswordRequestSchema,
  },
  'GET /auth/session': { summary: 'The current session, if any', tag: 'Auth' },

  'GET /me': { summary: 'The signed-in user', tag: 'Users' },

  'GET /users': {
    summary: 'Everyone in the organization, filtered and paged',
    tag: 'Users',
    query: listUsersQuerySchema,
  },
  'POST /users/import': {
    summary: 'Bulk-import users from a spreadsheet, with a dry run',
    tag: 'Users',
    body: importUsersRequestSchema,
  },
  'POST /users/invite': {
    summary: 'Invite someone by email',
    tag: 'Users',
    body: inviteUserRequestSchema,
  },
  'GET /users/:id': { summary: 'Read one user', tag: 'Users' },
  'POST /users/:id/deactivate': {
    summary: 'Deactivate a user; never delete',
    tag: 'Users',
    body: z.object({ reason: z.string().optional() }),
  },

  'GET /cycles': { summary: 'Every review cycle', tag: 'Cycles' },
  'POST /cycles': {
    summary: 'Create a review cycle with dated phases',
    tag: 'Cycles',
    body: createCycleRequestSchema,
  },
  'PATCH /cycles/:id': {
    summary: 'Reconfigure a cycle',
    tag: 'Cycles',
    body: updateCycleRequestSchema,
  },
  'POST /cycles/:id/activate': {
    summary: 'Activate a cycle',
    tag: 'Cycles',
    body: activateCycleRequestSchema,
  },
  'POST /cycles/:id/close': {
    summary: 'Close a cycle, leaving it readable',
    tag: 'Cycles',
    body: z.object({}),
  },

  'GET /sheets/:cycleId': { summary: 'My goal sheet for a cycle, scored', tag: 'Goal sheets' },
  'PUT /sheets/:cycleId': {
    summary: 'Save a draft goal sheet',
    tag: 'Goal sheets',
    body: saveDraftRequestSchema,
  },
  'POST /sheets/:id/submit': {
    summary: 'Submit a sheet for approval',
    tag: 'Goal sheets',
    body: z.object({}),
  },
  'POST /sheets/:id/check-in': {
    summary: 'Record progress against an approved sheet',
    tag: 'Goal sheets',
    body: checkInRequestSchema,
  },
  'POST /sheets/:id/approve': {
    summary: 'Approve and lock a sheet',
    tag: 'Approvals',
    body: approveSheetRequestSchema,
  },
  'POST /sheets/:id/return': {
    summary: 'Return a sheet for rework, with a required reason',
    tag: 'Approvals',
    body: returnSheetRequestSchema,
  },
  'POST /sheets/:id/adjust': {
    summary: 'Adjust weightages inline before approving',
    tag: 'Approvals',
    body: adjustWeightageRequestSchema,
  },
  'GET /sheets/:id/revisions': { summary: 'Every version of a sheet', tag: 'Approvals' },
  'GET /sheets/:id/review': {
    summary: "A report's sheet with its score, owner and check-in history",
    tag: 'Approvals',
  },

  'GET /queue': {
    summary: 'Everything in my reporting line awaiting action, most urgent first',
    tag: 'Approvals',
    query: listSheetsQuerySchema,
  },

  'GET /sheets/:sheetId/comments': {
    summary: 'The discussion on a sheet',
    tag: 'Discussion',
    query: listCommentsQuerySchema,
  },
  'POST /sheets/:sheetId/comments': {
    summary: 'Post a comment',
    tag: 'Discussion',
    body: createCommentRequestSchema,
  },
  'PATCH /sheets/:sheetId/comments/:commentId': {
    summary: 'Edit a comment inside its window',
    tag: 'Discussion',
    body: updateCommentRequestSchema,
  },
  'DELETE /sheets/:sheetId/comments/:commentId': {
    summary: 'Delete a comment, leaving a tombstone',
    tag: 'Discussion',
  },

  'GET /teams': { summary: 'Every team', tag: 'Org' },
  'POST /teams': { summary: 'Create a team', tag: 'Org', body: createTeamRequestSchema },
  'GET /teams/:id': { summary: 'One team and its members', tag: 'Org' },
  'GET /org-chart': {
    summary: 'Someone and everyone beneath them',
    tag: 'Org',
    query: orgChartQuerySchema,
  },
  'GET /org-chart/:userId/chain': { summary: 'The reporting line above someone', tag: 'Org' },

  'GET /shared-goals': { summary: 'Shared goals in a cycle', tag: 'Shared goals' },
  'POST /shared-goals': {
    summary: 'Create a shared goal and cascade it',
    tag: 'Shared goals',
    body: createSharedGoalRequestSchema,
  },
  'POST /shared-goals/preview': {
    summary: 'What a cascade would do, without doing it',
    tag: 'Shared goals',
    body: createSharedGoalRequestSchema,
  },

  'GET /appraisals/:sheetId': {
    summary: 'The appraisal, pre-populated with goals and scores',
    tag: 'Appraisal',
  },
  'PUT /appraisals/:sheetId/self': {
    summary: 'Save a self-appraisal draft',
    tag: 'Appraisal',
    body: selfAppraisalRequestSchema,
  },
  'POST /appraisals/:sheetId/self/submit': {
    summary: 'Submit a self-appraisal, locking it',
    tag: 'Appraisal',
    body: selfAppraisalRequestSchema,
  },
  'POST /appraisals/:sheetId/rating': {
    summary: "The manager's rating, with a required justification",
    tag: 'Appraisal',
    body: managerRatingRequestSchema,
  },
  'POST /appraisals/:sheetId/acknowledge': {
    summary: 'Acknowledge a released rating, optionally disputing it',
    tag: 'Appraisal',
    body: acknowledgeRatingRequestSchema,
  },

  'GET /calibration': { summary: 'Distribution, per-manager split and outliers', tag: 'Calibration' },
  'POST /calibration/adjust': {
    summary: 'Adjust a rating with a mandatory reason',
    tag: 'Calibration',
    body: calibrationAdjustmentRequestSchema,
  },
  'POST /calibration/release': {
    summary: 'Lock calibration and release results',
    tag: 'Calibration',
    body: releaseResultsRequestSchema,
  },

  'GET /analytics': {
    summary: 'Distribution analytics, counted in Postgres',
    tag: 'Governance',
    query: analyticsQuerySchema,
  },
  'GET /compliance': { summary: 'The live compliance dashboard', tag: 'Governance' },
  'GET /escalations': {
    summary: 'Open escalations with real overdue days',
    tag: 'Governance',
    query: listEscalationsQuerySchema,
  },
  'POST /escalations/:id/resolve': {
    summary: 'Resolve an escalation with a required note',
    tag: 'Governance',
    body: resolveEscalationRequestSchema,
  },
  'GET /audit': { summary: 'Search the audit trail', tag: 'Governance', query: listAuditQuerySchema },
};

/** `/users/:id` in Express is `/users/{id}` in OpenAPI. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

/** The path parameters a route declares, read back off its own path. */
function pathParams(path: string): z.ZodObject | undefined {
  const names = [...path.matchAll(/:(\w+)/g)].map((match) => match[1] ?? '');

  if (names.length === 0) {
    return undefined;
  }

  return z.object(Object.fromEntries(names.map((name) => [name, z.string()])));
}

const errorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    detail: z.array(z.string()).optional(),
  })
  .meta({ id: 'ApiError' });

/**
 * Build the document.
 *
 * Responses are described by status rather than by a schema per endpoint. That
 * is a deliberate limit and worth naming: the request side is generated from
 * the contracts and therefore cannot drift, while the response side is
 * documented by shape-of-outcome only. Wave 6 consumes these contracts from the
 * client, which is where response schemas earn their keep; asserting them here
 * first would be a second description with nothing checking it.
 */
export function buildDocument(): ReturnType<typeof createDocument> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const [key, doc] of Object.entries(ROUTE_DOCS)) {
    const [method = 'GET', path = '/'] = key.split(' ');
    const openApiPath = toOpenApiPath(path);
    const params = pathParams(path);

    paths[openApiPath] ??= {};
    paths[openApiPath][method.toLowerCase()] = {
      summary: doc.summary,
      tags: [doc.tag],
      requestParams: {
        ...(params === undefined ? {} : { path: params }),
        ...(doc.query === undefined ? {} : { query: doc.query }),
      },
      ...(doc.body === undefined
        ? {}
        : {
            requestBody: {
              content: { 'application/json': { schema: doc.body } },
            },
          }),
      responses: {
        '200': { description: 'Success' },
        '400': {
          description: 'The request did not parse against its contract',
          content: { 'application/json': { schema: errorSchema } },
        },
        '401': {
          description: 'No session',
          content: { 'application/json': { schema: errorSchema } },
        },
        '403': {
          description: 'The policy table refused this actor',
          content: { 'application/json': { schema: errorSchema } },
        },
      },
    };
  }

  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'AuraPMS API',
      version: '1.0.0',
      description:
        'Generated from the Zod contracts in `@aura/contracts` — the same schemas the ' +
        'server parses requests with, so this document cannot describe a payload the ' +
        'server would reject.',
    },
    servers: [{ url: '/', description: 'This server' }],
    paths,
  });
}
