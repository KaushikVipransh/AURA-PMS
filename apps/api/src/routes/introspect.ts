/**
 * Reading the route table back out of a built Express application.
 *
 * Exists so W3-09's permission matrix can enumerate what is actually mounted
 * rather than what someone remembered to list. A hand-maintained inventory of
 * routes is wrong the first time anyone adds one, and wrong silently — the
 * suite still passes and the new endpoint is the unguarded one.
 *
 * Express 5 moved its internals: the router is `app.router` and its layers
 * carry a `matchers` array instead of the old `regexp`. Both shapes are read
 * defensively below, because this walks undocumented internals and a version
 * bump changing them must surface as "no routes found" — which the matrix
 * asserts against — rather than as an empty pass.
 */

import type { Express } from 'express';

export type RouteRef = {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Full mounted path, e.g. `/users/:id/deactivate`. */
  readonly path: string;
};

type Layer = {
  name?: string;
  route?: { path?: unknown; methods?: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  matchers?: unknown[];
  regexp?: RegExp;
};

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/**
 * Recover a sub-router's mount prefix by matching the router object itself.
 *
 * Express 5 compiles a mount path into an opaque matcher **function** and keeps
 * no copy of the original string — `layer.path` is undefined and the matcher
 * has no `source`. The first version of this tried to un-escape a regexp, which
 * silently produced `/signup` instead of `/auth/signup`: a permission matrix
 * that checks the wrong paths and passes.
 *
 * Identity against the declared mount table has no such failure mode. If a
 * router is not in the table its routes come back unprefixed, and the matrix's
 * "covers every registered route" assertion fails loudly.
 */
function mountPath(layer: Layer, mounts: readonly RouterMount[]): string {
  return mounts.find((mount) => mount.router === layer.handle)?.prefix ?? '';
}

function walk(
  stack: Layer[],
  prefix: string,
  found: RouteRef[],
  mounts: readonly RouterMount[],
): void {
  for (const layer of stack) {
    if (layer.route !== undefined) {
      const path = typeof layer.route.path === 'string' ? layer.route.path : '';
      const methods = layer.route.methods ?? {};

      for (const [method, enabled] of Object.entries(methods)) {
        if (enabled && METHODS.has(method)) {
          found.push({
            method: method.toUpperCase() as RouteRef['method'],
            path: normalise(prefix + path),
          });
        }
      }
      continue;
    }

    if (layer.name === 'router' && layer.handle?.stack !== undefined) {
      walk(layer.handle.stack, prefix + mountPath(layer, mounts), found, mounts);
    }
  }
}

function normalise(path: string): string {
  const collapsed = path.replace(/\/{2,}/g, '/');

  return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : collapsed;
}

/** A router and the prefix it is mounted at. */
export type RouterMount = { readonly prefix: string; readonly router: unknown };

/** Every route mounted on `app`, in registration order. */
export function listRoutes(app: Express, mounts: readonly RouterMount[] = []): RouteRef[] {
  const router = (app as unknown as { router?: { stack?: Layer[] } }).router;
  const found: RouteRef[] = [];

  walk(router?.stack ?? [], '', found, mounts);

  return found;
}
