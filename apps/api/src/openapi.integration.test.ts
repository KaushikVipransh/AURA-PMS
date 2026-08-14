import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { ROUTER_MOUNTS, createApp } from './app.js';
import {
  BODY_METHODS,
  ROUTE_DOCS,
  UNDOCUMENTED,
  buildDocument,
  toOpenApiPath,
} from './openapi.js';
import { listRoutes, type RouteRef } from './routes/introspect.js';

/**
 * W4-21 — **a route missing from the document fails the build.**
 *
 * The same shape as W3-09's permission matrix, and for the same reason. A
 * handwritten API document drifts from the server silently, and the drift is
 * found by a client that trusted it. Enumerating the live router and comparing
 * is the only version of this check that cannot rot.
 */

const app = createApp();
const routes = listRoutes(app, ROUTER_MOUNTS);
const key = (route: RouteRef): string => `${route.method} ${route.path}`;

describe('the OpenAPI document covers the live surface', () => {
  it('finds routes at all, so an empty enumeration cannot pass vacuously', () => {
    expect(routes.length).toBeGreaterThanOrEqual(55);
  });

  it('documents every registered route, or says why not', () => {
    const missing = routes
      .map(key)
      .filter((name) => !(name in ROUTE_DOCS) && !(name in UNDOCUMENTED));

    expect(
      missing,
      'A route was added with no entry in ROUTE_DOCS. Add one, or list it in ' +
        'UNDOCUMENTED with a reason -- a document that quietly omits an endpoint ' +
        'is worse than none, because people act on it.',
    ).toEqual([]);
  });

  it('has no entries for routes that no longer exist', () => {
    const live = new Set(routes.map(key));
    const stale = [...Object.keys(ROUTE_DOCS), ...Object.keys(UNDOCUMENTED)].filter(
      (name) => !live.has(name),
    );

    expect(stale).toEqual([]);
  });

  it('gives a reason for every route left out on purpose', () => {
    for (const [name, reason] of Object.entries(UNDOCUMENTED)) {
      expect(reason, `${name} is undocumented with no reason given`).toBeTruthy();
    }
  });

  it('names a contract schema for every route that takes a body', () => {
    const unschemad = Object.entries(ROUTE_DOCS)
      .filter(([name]) => BODY_METHODS.has(name.split(' ')[0] ?? ''))
      .filter(([, doc]) => doc.body === undefined)
      .map(([name]) => name);

    // This is the assertion that makes the document generated rather than
    // written: a POST whose body is described in prose is a description that
    // can disagree with the parser.
    expect(unschemad).toEqual([]);
  });

  it('describes every route with a summary and a tag', () => {
    for (const [name, doc] of Object.entries(ROUTE_DOCS)) {
      expect(doc.summary.length, `${name} has no summary`).toBeGreaterThan(0);
      expect(doc.tag.length, `${name} has no tag`).toBeGreaterThan(0);
    }
  });
});

describe('the document itself', () => {
  const document = buildDocument();

  it('is valid OpenAPI 3.1 with a title and paths', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('AuraPMS API');
    expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(0);
  });

  it('translates Express parameters into OpenAPI ones', () => {
    expect(toOpenApiPath('/users/:id')).toBe('/users/{id}');
    expect(toOpenApiPath('/sheets/:sheetId/comments/:commentId')).toBe(
      '/sheets/{sheetId}/comments/{commentId}',
    );
    expect(toOpenApiPath('/teams')).toBe('/teams');
  });

  it('carries a generated request body, not a hand-written one', () => {
    const body = (
      document.paths?.['/cycles']?.post as {
        requestBody?: { content: { 'application/json': { schema: unknown } } };
      }
    )?.requestBody;

    const schema = body?.content['application/json'].schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    // These came out of `createCycleRequestSchema`. Nobody typed them here, so
    // they cannot describe a payload the route would reject.
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(['name', 'fiscalYear', 'phases', 'ratingScale']),
    );
    expect(schema.required).toContain('ratingScale');
  });

  it('declares path parameters for every parameterised route', () => {
    const params = (
      document.paths?.['/sheets/{sheetId}/comments/{commentId}']?.patch as {
        parameters?: { name: string; in: string }[];
      }
    )?.parameters;

    expect(params?.filter((param) => param.in === 'path').map((param) => param.name).sort()).toEqual(
      ['commentId', 'sheetId'],
    );
  });
});

describe('serving it', () => {
  it('publishes the document without a session', async () => {
    const response = await request(app).get('/openapi.json');

    expect(response.status).toBe(200);
    expect((response.body as { openapi: string }).openapi).toBe('3.1.0');
  });

  it('serves a reader that points at it', async () => {
    const response = await request(app).get('/docs');

    expect(response.status).toBe(200);
    expect(response.text).toContain('/openapi.json');
  });

  it('does not make the endpoints it documents reachable', async () => {
    // Publishing the map is not unlocking the doors, and the two are worth
    // checking together rather than assuming.
    const guarded = await request(app).get('/cycles');

    expect(guarded.status).toBe(401);
  });
});
