/**
 * Signup, login, logout and session (PRD US-102, E1).
 *
 * These four are hand-written rather than delegated to the auth library's own
 * routes, for one reason: signup here is not "create a user". It is "create an
 * organization and its first administrator", which is a domain operation the
 * library has no concept of.
 */

import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
} from '@aura/contracts';
import { prisma } from '@aura/db';
import { Router, type Request, type Response } from 'express';

import {
  createSession,
  createUser,
  getActor,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  revokeSessionByCookie,
} from '../auth/index.js';
import { parseBody } from '../validate.js';

/**
 * The same answer for a wrong password and for an address that has never
 * existed.
 *
 * Anything that differs between the two — a different message, a different
 * status, a different shape — turns the login form into a tool for discovering
 * who has an account here. For a performance management system that is a list
 * of a company's employees.
 */
const INVALID_CREDENTIALS = { error: 'Invalid email or password' } as const;

/**
 * The single answer `POST /auth/forgot` gives, in every case.
 *
 * Phrased as an acknowledgement rather than a confirmation: "if that address
 * has an account, a link is on its way" is true whether or not it does.
 */
const ACCEPTED = {
  ok: true,
  message: 'If that address has an account, a reset link is on its way.',
} as const;

/** Where the reset link points. The SPA route that collects a new password. */
function resetRedirectUrl(): string {
  const base = process.env['APP_URL'] ?? 'http://localhost:5173';

  return `${base.replace(/\/$/, '')}/reset-password`;
}

/** Copy the auth library's `Set-Cookie` headers onto an Express response. */
function forwardCookies(headers: Headers, res: Response): void {
  const cookies = headers.getSetCookie();

  if (cookies.length > 0) {
    res.append('Set-Cookie', cookies);
  }
}

export const authRouter: Router = Router();

/**
 * Create an organization and its first administrator.
 *
 * **Not atomic, and that is a known limitation rather than an oversight.** The
 * auth library writes the user through its own adapter, outside any transaction
 * we could open, so the organization must exist before the user can reference
 * it. A failed signup therefore compensates by deleting the organization it
 * just made — safe precisely because nothing else can reference it yet, within
 * the few milliseconds it has existed.
 *
 * The alternative — a nullable `orgId` filled in afterwards — is the shape
 * PLAN.md F-02 is about, and no amount of care makes a nullable tenancy column
 * safe.
 */
authRouter.post('/signup', (req: Request, res: Response, next) => {
  void (async () => {
    const parsed = parseBody(signupRequestSchema, req.body);

    if (!parsed.ok) {
      res.status(400).json(parsed.error);
      return;
    }

    const { organizationName, name, email, password } = parsed.data;

    // Checked before creating anything, so the ordinary "that address is taken"
    // case does not leave a compensating delete to perform.
    if ((await prisma.user.count({ where: { email } })) > 0) {
      res.status(409).json({ error: 'That email address is already registered' });
      return;
    }

    const slug = organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    const org = await prisma.organization.create({
      data: { name: organizationName, slug: `${slug}-${Date.now().toString(36)}` },
    });

    try {
      await createUser({ email, password, name, orgId: org.id });
    } catch (error) {
      await prisma.organization.delete({ where: { id: org.id } });
      next(error);
      return;
    }

    /*
     * Promoted after creation, never at sign-up.
     *
     * `roles` is deliberately not an `additionalField`, so it cannot be set
     * from a request body — a client naming its own roles would make the whole
     * of W2-06 decorative. The first user of a brand new organization is its
     * administrator by construction, which is a fact the server decides.
     */
    const user = await prisma.user.update({
      where: { email },
      data: { roles: ['ORG_ADMIN', 'EMPLOYEE'], status: 'ACTIVE', emailVerified: false },
    });

    const { headers } = await createSession(email, password);
    forwardCookies(headers, res);

    res.status(201).json({
      user: {
        id: user.id,
        orgId: user.orgId,
        name: user.name,
        email: user.email,
        roles: user.roles,
      },
      organization: { id: org.id, name: org.name, slug: org.slug },
    });
  })().catch(next);
});

authRouter.post('/login', (req: Request, res: Response, next) => {
  void (async () => {
    const parsed = parseBody(loginRequestSchema, req.body);

    if (!parsed.ok) {
      // Not `parsed.error`: a field-level "email is malformed" is a different
      // answer from "those credentials are wrong", and the difference is
      // readable from outside.
      res.status(401).json(INVALID_CREDENTIALS);
      return;
    }

    let issued: { headers: Headers; actor: Awaited<ReturnType<typeof getActor>> };
    try {
      issued = await createSession(parsed.data.email, parsed.data.password);
    } catch {
      res.status(401).json(INVALID_CREDENTIALS);
      return;
    }

    const { headers, actor } = issued;

    if (actor === null || !actor.isActive) {
      /*
       * A deactivated user authenticates successfully and is still refused
       * (PRD US-106) — their password is correct, their access is not. The
       * session just issued is revoked rather than left behind.
       */
      await revokeSessionByCookie(headers.getSetCookie().join('; '));
      res.status(401).json(INVALID_CREDENTIALS);
      return;
    }

    forwardCookies(headers, res);
    res.status(200).json({ user: actorPayload(actor) });
  })().catch(next);
});

/**
 * Ask for a reset link (PRD US-103).
 *
 * **Always answers `202`, whatever happened.** A response that differs for a
 * known and an unknown address turns this endpoint into a membership oracle for
 * the company's staff list — and unlike login, this one needs no password to
 * query, so it is the easier of the two to abuse.
 *
 * A malformed email is answered the same way for the same reason.
 */
authRouter.post('/forgot', (req: Request, res: Response, next) => {
  void (async () => {
    const parsed = parseBody(forgotPasswordRequestSchema, req.body);

    if (parsed.ok) {
      await requestPasswordReset(parsed.data.email, resetRedirectUrl());
    }

    res.status(202).json(ACCEPTED);
  })().catch(next);
});

/**
 * Complete the reset.
 *
 * On success every other session is revoked — configured in `config.ts`, and
 * asserted here. The usual reason to reset a password is that someone else may
 * know it, so leaving their sessions alive preserves exactly the access the
 * reset was meant to remove.
 */
authRouter.post('/reset', (req: Request, res: Response, next) => {
  void (async () => {
    const parsed = parseBody(resetPasswordRequestSchema, req.body);

    if (!parsed.ok) {
      // Field detail is safe here: it is about the new password's strength,
      // which the caller already knows, and says nothing about the token.
      res.status(400).json(parsed.error);
      return;
    }

    const accepted = await resetPassword(parsed.data.token, parsed.data.password);

    if (!accepted) {
      res.status(400).json({ error: 'That reset link is invalid or has expired' });
      return;
    }

    res.status(204).end();
  })().catch(next);
});

authRouter.post('/logout', (req: Request, res: Response, next) => {
  void (async () => {
    // Server-side. A logout that only clears the cookie leaves a valid session
    // behind, so anyone who captured it stays signed in.
    await revokeSession(req);

    // Idempotent by design: logging out twice, or without a session at all, is
    // not an error worth reporting to a client that wants to be signed out.
    res.status(204).end();
  })().catch(next);
});

authRouter.get('/session', (req: Request, res: Response, next) => {
  void (async () => {
    const actor = await getActor(req);

    if (actor === null) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    res.status(200).json({ user: actorPayload(actor) });
  })().catch(next);
});

function actorPayload(actor: {
  userId: string;
  orgId: string;
  roles: readonly string[];
  isActive: boolean;
}) {
  return {
    id: actor.userId,
    orgId: actor.orgId,
    roles: actor.roles,
    isActive: actor.isActive,
  };
}
