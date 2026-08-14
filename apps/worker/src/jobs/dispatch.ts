/**
 * The notification dispatcher (PRD US-1201, US-1202, US-1203) — W5-04.
 *
 * Turns a queued job into rows that record what was actually delivered. The
 * prototype's equivalent wrote a status string onto a document and sent
 * nothing at all (PLAN.md F-08); a row per channel with a status and a
 * timestamp is what makes the delivery log in US-1203 a report rather than an
 * assertion.
 *
 * **Suppression is decided from the template, not from the job.** Whoever
 * enqueues a notification does not get to declare it mandatory — the template
 * says whether a category is suppressible, and a compliance notice is not.
 * Someone who has missed a deadline being able to silence the reminder about
 * it defeats the purpose of having one (US-1202).
 */

import { prisma } from '@aura/db';
import {
  UnknownNotificationError,
  isSuppressible,
  renderNotification,
  type NotificationCategory,
} from '@aura/core';

import { emailAdapterFromEnv, type EmailAdapter } from '../email.js';

export type DispatchJob = {
  readonly orgId: string;
  readonly userId: string;
  /** Dotted event type; must name a template in `@aura/core`. */
  readonly type: string;
  readonly payload?: Readonly<Record<string, string>>;
};

export type DispatchOutcome = {
  readonly inApp: 'SENT' | 'SUPPRESSED';
  readonly email: 'SENT' | 'SUPPRESSED' | 'FAILED';
  readonly mandatory: boolean;
};

type ChannelPreference = { email?: unknown; inApp?: unknown };

/**
 * Read one category's preference off a user's stored JSON.
 *
 * An absent category means enabled, so a category added later is on by default
 * rather than silently off for everyone who signed up before it existed —
 * which would be a notification system that quietly stops notifying.
 */
export function prefersChannel(
  preferences: unknown,
  category: NotificationCategory,
  channel: 'email' | 'inApp',
): boolean {
  const all = preferences as Record<string, ChannelPreference> | null;
  const setting = all?.[category]?.[channel];

  return typeof setting === 'boolean' ? setting : true;
}

/**
 * Deliver one notification.
 *
 * The in-app row is written whether or not it was suppressed, with the status
 * saying which. A suppressed notification that left no row would make "why did
 * nobody hear about this" unanswerable, and that question is the whole reason
 * the delivery log exists.
 *
 * @throws {UnknownNotificationError} when the type names no template. Failing
 * is deliberate: a fallback that sent "You have a notification" would deliver a
 * message with no information in it, and unlike a failed job nobody would
 * notice.
 */
export async function dispatchNotification(
  job: DispatchJob,
  adapter: EmailAdapter = emailAdapterFromEnv(),
): Promise<DispatchOutcome> {
  const rendered = renderNotification(job.type, job.payload ?? {});
  const suppressible = isSuppressible(job.type);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: job.userId },
    select: { email: true, status: true, notificationPreferences: true },
  });

  const wants = (channel: 'email' | 'inApp'): boolean =>
    !suppressible || prefersChannel(user.notificationPreferences, rendered.category, channel);

  /*
   * A deactivated account receives nothing on either channel, whatever the
   * template says. "Mandatory" means a person cannot opt out of it, not that
   * it should follow them out of the organization.
   */
  const active = user.status !== 'DEACTIVATED';
  const inAppWanted = active && wants('inApp');
  const emailWanted = active && wants('email');

  const base = {
    orgId: job.orgId,
    userId: job.userId,
    type: job.type,
    // Taken from the template, never from the job payload.
    mandatory: rendered.mandatory,
    payload: {
      ...job.payload,
      subject: rendered.subject,
      body: rendered.body,
      link: rendered.link,
      category: rendered.category,
    },
  };

  await prisma.notification.create({
    data: {
      ...base,
      channel: 'IN_APP',
      status: inAppWanted ? 'SENT' : 'SUPPRESSED',
      ...(inAppWanted ? { sentAt: new Date() } : {}),
    },
  });

  let email: DispatchOutcome['email'] = 'SUPPRESSED';

  if (emailWanted) {
    const result = await adapter.send({
      to: user.email,
      subject: rendered.subject,
      body: rendered.body,
      link: rendered.link,
    });

    email = result.ok ? 'SENT' : 'FAILED';

    await prisma.notification.create({
      data: {
        ...base,
        channel: 'EMAIL',
        status: result.ok ? 'SENT' : 'FAILED',
        ...(result.ok ? { sentAt: new Date() } : { failureReason: result.reason }),
      },
    });
  } else {
    await prisma.notification.create({
      data: { ...base, channel: 'EMAIL', status: 'SUPPRESSED' },
    });
  }

  return {
    inApp: inAppWanted ? 'SENT' : 'SUPPRESSED',
    email,
    mandatory: rendered.mandatory,
  };
}

export { UnknownNotificationError };
