/**
 * Authentication contracts (PRD E1).
 *
 * The prototype had none of this: no login, no session, no actor. Every
 * request ran as a hardcoded `emp-123` against an API with open CORS
 * (PLAN.md F-01, F-02).
 */

import { z } from 'zod';

import { emailSchema, idSchema, passwordSchema, roleSchema, shortTextSchema } from './common.js';

/** Creating an organisation and its first admin in one step (PRD US-102). */
export const signupRequestSchema = z.object({
  organizationName: shortTextSchema,
  name: shortTextSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'Password is required.' }),
});

/**
 * Login does not reuse `passwordSchema`.
 *
 * Rejecting a short password at login leaks that the stored one is longer, and
 * it would lock out anyone whose password predates a raised minimum. The floor
 * belongs on the way in, not on the way back.
 */
export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const sessionUserSchema = z.object({
  id: idSchema,
  orgId: idSchema,
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  timeZone: z.string(),
});

export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  expiresAt: z.iso.datetime({ offset: true }),
});

/**
 * Forgot-password always answers the same way.
 *
 * A response that differs for a known and an unknown address is an account
 * enumeration oracle, so the endpoint returns this regardless (PRD US-103).
 */
export const acknowledgementSchema = z.object({
  ok: z.literal(true),
});

export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;
