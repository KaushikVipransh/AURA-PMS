/**
 * What a notification says, and whether it may be suppressed (PRD US-1201,
 * US-1202, W5-03).
 *
 * Lives in `@aura/core` and is therefore pure: rendering a message is a
 * function from data to text, and putting it here means the worker that sends
 * it and the tests that check it use the same one. The prototype's
 * "notification chain" was a status string written onto a document — nothing
 * was ever rendered and nothing was ever sent (PLAN.md F-08).
 *
 * **Every template names a link.** A notification that says something happened
 * without saying where to go about it is a notification people learn to
 * ignore, which is the failure mode US-1201 describes.
 */

/** How a person may configure a category of notification. */
export const NOTIFICATION_CATEGORIES = [
  'GOAL_SETTING',
  'APPROVALS',
  'CHECK_INS',
  'APPRAISAL',
  'COMPLIANCE',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type NotificationTemplate = {
  readonly category: NotificationCategory;
  /**
   * Whether a person may turn this off.
   *
   * Compliance notices may not (US-1202). Someone who has missed a deadline
   * being able to silence the reminder about it defeats the entire purpose of
   * having one, and the dispatcher labels these in the UI rather than hiding
   * that they were forced.
   */
  readonly mandatory: boolean;
  readonly subject: (data: Readonly<Record<string, string>>) => string;
  readonly body: (data: Readonly<Record<string, string>>) => string;
  /** Where to go about it. Relative, so one template serves every environment. */
  readonly link: (data: Readonly<Record<string, string>>) => string;
};

const get = (data: Readonly<Record<string, string>>, key: string): string => data[key] ?? '';

/**
 * Every notification the system can send, by its dotted event type.
 *
 * The keys match the `type` column on `Notification`, which is what lets the
 * dispatcher look a template up without a translation table in between.
 */
export const NOTIFICATION_TEMPLATES: Readonly<Record<string, NotificationTemplate>> = {
  'user.invited': {
    category: 'GOAL_SETTING',
    mandatory: true,
    subject: () => 'You have been invited to AuraPMS',
    body: (d) => `${get(d, 'inviterName')} has invited you to join ${get(d, 'organizationName')}.`,
    link: (d) => `/accept-invite?token=${get(d, 'token')}`,
  },

  'goalsheet.submitted': {
    category: 'APPROVALS',
    mandatory: false,
    subject: (d) => `${get(d, 'employeeName')} submitted their goals`,
    body: (d) => `${get(d, 'employeeName')} has submitted their goal sheet for your approval.`,
    link: (d) => `/sheets/${get(d, 'sheetId')}`,
  },

  'goalsheet.approved': {
    category: 'APPROVALS',
    mandatory: false,
    subject: () => 'Your goals have been approved',
    body: (d) =>
      `${get(d, 'approverName')} approved your goal sheet. It is now locked for the cycle.`,
    link: (d) => `/sheets/${get(d, 'sheetId')}`,
  },

  'goalsheet.returned': {
    category: 'APPROVALS',
    mandatory: false,
    /* The reason travels in the body rather than being left to a follow-up
       conversation. A sheet returned with no explanation is the failure
       US-305 exists to fix: the employee is told to change something and not
       what. */
    subject: () => 'Your goals need changes',
    body: (d) => `${get(d, 'managerName')} returned your goal sheet. Reason: ${get(d, 'reason')}`,
    link: (d) => `/sheets/${get(d, 'sheetId')}`,
  },

  'goalsheet.adjusted': {
    category: 'APPROVALS',
    mandatory: false,
    subject: () => 'Your goal weightages were adjusted',
    body: (d) =>
      `${get(d, 'managerName')} adjusted the weightages on your goal sheet. Note: ${get(d, 'note')}`,
    link: (d) => `/sheets/${get(d, 'sheetId')}`,
  },

  'sharedgoal.assigned': {
    category: 'GOAL_SETTING',
    mandatory: false,
    subject: (d) => `A shared goal was added to your sheet: ${get(d, 'title')}`,
    body: (d) => `"${get(d, 'title')}" has been cascaded to your goal sheet.`,
    link: (d) => `/sheets?sharedGoalId=${get(d, 'sharedGoalId')}`,
  },

  'appraisal.calibrated': {
    category: 'APPRAISAL',
    mandatory: true,
    subject: () => 'A rating you wrote was adjusted in calibration',
    body: (d) =>
      `The final rating moved from ${get(d, 'from')} to ${get(d, 'to')}. Reason: ${get(d, 'reason')}`,
    link: (d) => `/appraisals/${get(d, 'appraisalId')}`,
  },

  'appraisal.released': {
    category: 'APPRAISAL',
    mandatory: true,
    subject: () => 'Your performance rating is available',
    body: () => 'Your rating for this cycle has been released. Please review and acknowledge it.',
    link: (d) => `/appraisals/${get(d, 'appraisalId')}`,
  },

  /**
   * The weekly digest (W5-06).
   *
   * Suppressible, unlike the escalations it summarises. Someone who has opted
   * out of the weekly round-up still gets the individual compliance notices —
   * the digest is a convenience, and the notices are not.
   */
  'digest.weekly': {
    category: 'GOAL_SETTING',
    mandatory: false,
    subject: () => 'Your week in AuraPMS',
    body: (d) =>
      `Waiting on you: ${get(d, 'awaitingApproval')} approvals, ` +
      `${get(d, 'unsubmitted')} unsubmitted sheets, ` +
      `${get(d, 'escalations')} open escalations.`,
    link: () => '/dashboard',
  },

  'escalation.goals_not_submitted': {
    category: 'COMPLIANCE',
    mandatory: true,
    subject: (d) => `Overdue: goal sheet not submitted (${get(d, 'daysOverdue')} days)`,
    body: (d) =>
      `A goal sheet is ${get(d, 'daysOverdue')} days past its deadline and has not been submitted.`,
    link: (d) => `/escalations/${get(d, 'escalationId')}`,
  },

  'escalation.approval_overdue': {
    category: 'COMPLIANCE',
    mandatory: true,
    subject: (d) => `Overdue: approval outstanding (${get(d, 'daysOverdue')} days)`,
    body: (d) => `A submitted goal sheet has been awaiting your approval for ${get(d, 'daysOverdue')} days.`,
    link: (d) => `/escalations/${get(d, 'escalationId')}`,
  },

  'escalation.check_in_missing': {
    category: 'COMPLIANCE',
    mandatory: true,
    subject: (d) => `Overdue: no check-in recorded (${get(d, 'daysOverdue')} days)`,
    body: (d) => `No progress has been recorded for ${get(d, 'daysOverdue')} days past the deadline.`,
    link: (d) => `/escalations/${get(d, 'escalationId')}`,
  },

  'escalation.self_appraisal_overdue': {
    category: 'COMPLIANCE',
    mandatory: true,
    subject: (d) => `Overdue: self-appraisal not submitted (${get(d, 'daysOverdue')} days)`,
    body: (d) => `A self-appraisal is ${get(d, 'daysOverdue')} days past its deadline.`,
    link: (d) => `/escalations/${get(d, 'escalationId')}`,
  },

  'escalation.manager_rating_overdue': {
    category: 'COMPLIANCE',
    mandatory: true,
    subject: (d) => `Overdue: rating not submitted (${get(d, 'daysOverdue')} days)`,
    body: (d) => `A manager rating is ${get(d, 'daysOverdue')} days past its deadline.`,
    link: (d) => `/escalations/${get(d, 'escalationId')}`,
  },
};

export type RenderedNotification = {
  readonly subject: string;
  readonly body: string;
  readonly link: string;
  readonly category: NotificationCategory;
  readonly mandatory: boolean;
};

/** Raised when a notification names a type nothing knows how to render. */
export class UnknownNotificationError extends Error {
  readonly type: string;

  constructor(type: string) {
    super(
      `No template for notification type "${type}". A notification nobody can render is a ` +
        'notification nobody receives, so this fails rather than sending an empty message.',
    );
    this.name = 'UnknownNotificationError';
    this.type = type;
  }
}

/**
 * Render a notification, or refuse.
 *
 * Throwing on an unknown type is the point. The alternative — a fallback that
 * sends "You have a notification" — produces a message with no information in
 * it, which is worse than a failed job: the job would be retried and noticed,
 * and the empty message would not.
 *
 * @throws {UnknownNotificationError}
 */
export function renderNotification(
  type: string,
  data: Readonly<Record<string, string>> = {},
): RenderedNotification {
  const template = NOTIFICATION_TEMPLATES[type];

  if (template === undefined) {
    throw new UnknownNotificationError(type);
  }

  return {
    subject: template.subject(data),
    body: template.body(data),
    link: template.link(data),
    category: template.category,
    mandatory: template.mandatory,
  };
}

/**
 * Whether this notification may be suppressed by a preference.
 *
 * Asked of the template rather than of the caller, so a mandatory notice
 * cannot be turned off by whoever enqueues it. `mandatory` on the row is set
 * *from* this, not trusted from the job payload.
 */
export function isSuppressible(type: string): boolean {
  return NOTIFICATION_TEMPLATES[type]?.mandatory === false;
}
