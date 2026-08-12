/**
 * Who may do what to whom.
 *
 * The prototype had no answer to this question, because it had no actor: every
 * request ran as a hardcoded `employeeId: 'emp-123'` against an API with open
 * CORS and no authentication at all (PLAN.md F-01, F-02). Authorisation was a
 * matter of which buttons the UI happened to render.
 *
 * Two axes decide every case, and keeping them separate is the point:
 *
 *   - **Role** — what kind of user this is.
 *   - **Relationship** — how the actor stands to the person the resource is
 *     about: themselves, a direct report, someone further down their chain, or
 *     merely a colleague.
 *
 * Neither axis alone is sufficient, and collapsing them is where real systems
 * leak. "HR may view goal sheets" is true but not "HR may write your
 * self-appraisal"; "you may write your self-appraisal" is true but not "you may
 * approve it". So the table below states, per action, which relationships each
 * role may exercise. A role absent from an action's entry cannot perform it at
 * all.
 *
 * This module answers *is this the right person*. Whether it is the right
 * **time** is `isActionAllowed` in `./cycle.ts` (W2-03), and an endpoint must
 * satisfy both — see W3-09, whose matrix is generated from this table.
 */

export const ROLES = ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'ORG_ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/**
 * How an actor stands to the subject of a resource.
 *
 * Ordered from closest to furthest. Exactly one applies to any pair — `SELF`
 * beats `DIRECT_REPORT` beats `INDIRECT_REPORT` beats `SAME_ORG` — so a rule
 * listing `SAME_ORG` grants nothing about a person's own record.
 */
export const RELATIONSHIPS = [
  'SELF',
  'DIRECT_REPORT',
  'INDIRECT_REPORT',
  'SAME_ORG',
  'OTHER_ORG',
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export type Actor = {
  readonly userId: string;
  readonly orgId: string;
  /**
   * Every role the user holds, because `User.roles` is an array.
   *
   * An HR admin is almost always also an employee with a goal sheet of their
   * own, and a manager who runs a team still has one. A single role would force
   * that person to be one thing, and the natural workaround — picking the
   * "highest" — is how someone ends up unable to submit their own goals.
   *
   * An action is permitted if **any** held role permits it. That is a union
   * rather than a maximum on purpose: it does not depend on the role ladder
   * continuing to hold, which is an invariant the table happens to satisfy
   * today and is not required to satisfy forever.
   */
  readonly roles: readonly Role[];
  /**
   * A departing employee keeps their history but loses their access
   * (PRD US-106). Deactivation is checked before anything else.
   */
  readonly isActive: boolean;
};

export type Resource = {
  readonly orgId: string;
  /** The person this resource is about; `null` for org-wide resources. */
  readonly subjectUserId: string | null;
  /** The subject's reporting line, nearest manager first. */
  readonly managerChainIds: readonly string[];
};

export const POLICY_ACTIONS = [
  // Identity and access (PRD E1, E2)
  'INVITE_USER',
  'BULK_IMPORT_USERS',
  'DEACTIVATE_USER',
  'VIEW_USER',
  'CREATE_CYCLE',
  'CONFIGURE_CYCLE',
  // Goal setting (PRD E3)
  'CREATE_GOAL_SHEET',
  'EDIT_GOAL_SHEET',
  'DELETE_GOAL',
  'SUBMIT_GOAL_SHEET',
  'VIEW_GOAL_SHEET',
  // Cascade and approval (PRD E4, E5)
  'CASCADE_SHARED_GOAL',
  'APPROVE_GOAL_SHEET',
  'RETURN_GOAL_SHEET',
  'ADJUST_WEIGHTAGE',
  'FORCE_UNLOCK_SHEET',
  'DELEGATE_APPROVALS',
  // Check-ins (PRD E6)
  'RECORD_CHECK_IN',
  'COMMENT_ON_SHEET',
  'VIEW_PROGRESS_TREND',
  // Appraisal (PRD E7)
  'WRITE_SELF_APPRAISAL',
  'RATE_REPORT',
  'VIEW_FINAL_RATING',
  'ACKNOWLEDGE_RATING',
  // Calibration (PRD E8)
  'VIEW_CALIBRATION',
  'ADJUST_RATING_IN_CALIBRATION',
  'RELEASE_RESULTS',
  // Compliance (PRD E9)
  'VIEW_COMPLIANCE_DASHBOARD',
  'RESOLVE_ESCALATION',
  // Analytics (PRD E10)
  'VIEW_ANALYTICS',
  'EXPORT_CYCLE_DATA',
  'VIEW_TEAM_ROLLUP',
  // Audit (PRD E11)
  'VIEW_AUDIT_TRAIL',
  'VIEW_SHEET_REVISIONS',
] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

/** Which relationships a given role may exercise. An absent role is denied. */
export type ActionPolicy = Readonly<Partial<Record<Role, readonly Relationship[]>>>;

/* Relationship sets, named so the table reads as intent rather than as lists.
   `OTHER_ORG` appears in none of them, and a test asserts that it never will:
   tenancy is not a permission anyone can be granted (PRD US-105). */
const SELF = ['SELF'] as const;
const REPORTS = ['DIRECT_REPORT', 'INDIRECT_REPORT'] as const;
const DIRECT_REPORT = ['DIRECT_REPORT'] as const;
const SELF_AND_REPORTS = ['SELF', 'DIRECT_REPORT', 'INDIRECT_REPORT'] as const;
const ANYONE_IN_ORG = ['SELF', 'DIRECT_REPORT', 'INDIRECT_REPORT', 'SAME_ORG'] as const;
const ANYONE_BUT_SELF = ['DIRECT_REPORT', 'INDIRECT_REPORT', 'SAME_ORG'] as const;
const ORG_WIDE = ['SAME_ORG'] as const;

/**
 * The whole authorisation model, in one readable table.
 *
 * Each entry cites the user story it implements. When a story changes, this is
 * the single place the change lands — and W3-09's endpoint matrix, W2-03's
 * timing table and the UI's disabled states all read from here rather than
 * re-deriving it, which is what stops them drifting apart.
 */
export const POLICY: Readonly<Record<PolicyAction, ActionPolicy>> = {
  /** US-101 — invite users by email with a role and a manager. */
  INVITE_USER: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /** US-205 — bulk-import users from CSV. */
  BULK_IMPORT_USERS: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /**
   * US-106 — deactivate a departing employee.
   *
   * `SELF` is excluded: the last org admin deactivating themselves locks the
   * organisation out of its own account with no route back in.
   */
  DEACTIVATE_USER: { HR_ADMIN: ANYONE_BUT_SELF, ORG_ADMIN: ANYONE_BUT_SELF },

  /** US-101 — the org chart is visible to those who need it. */
  VIEW_USER: {
    EMPLOYEE: SELF,
    MANAGER: SELF_AND_REPORTS,
    HR_ADMIN: ANYONE_IN_ORG,
    ORG_ADMIN: ANYONE_IN_ORG,
  },

  /** US-201, US-202 — create a cycle with named phases and dates. */
  CREATE_CYCLE: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /** US-203, US-204 — rating scale and escalation rules per cycle. */
  CONFIGURE_CYCLE: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /** US-301 — your goals are yours to draft. Nobody drafts them for you. */
  CREATE_GOAL_SHEET: {
    EMPLOYEE: SELF,
    MANAGER: SELF,
    HR_ADMIN: SELF,
    ORG_ADMIN: SELF,
  },

  /** US-301, US-305 — edit your own sheet, including after it is returned. */
  EDIT_GOAL_SHEET: {
    EMPLOYEE: SELF,
    MANAGER: SELF,
    HR_ADMIN: SELF,
    ORG_ADMIN: SELF,
  },

  /** US-404 — removing a goal is the owner's act; mandated goals are blocked by state, not by role. */
  DELETE_GOAL: {
    EMPLOYEE: SELF,
    MANAGER: SELF,
    HR_ADMIN: SELF,
    ORG_ADMIN: SELF,
  },

  /** US-302 — submitting is an assertion about your own work. */
  SUBMIT_GOAL_SHEET: {
    EMPLOYEE: SELF,
    MANAGER: SELF,
    HR_ADMIN: SELF,
    ORG_ADMIN: SELF,
  },

  /** US-304, US-704 — visible to the employee, their chain, and HR. */
  VIEW_GOAL_SHEET: {
    EMPLOYEE: SELF,
    MANAGER: SELF_AND_REPORTS,
    HR_ADMIN: ANYONE_IN_ORG,
    ORG_ADMIN: ANYONE_IN_ORG,
  },

  /** US-401 — push a departmental KPI down the chain you actually own. */
  CASCADE_SHARED_GOAL: {
    MANAGER: REPORTS,
    HR_ADMIN: ANYONE_BUT_SELF,
    ORG_ADMIN: ANYONE_BUT_SELF,
  },

  /**
   * US-502, US-504 — approve a report's sheet; second-level approval reaches
   * further down the chain. Never `SELF`: approving your own goals is the one
   * thing an approval workflow exists to prevent.
   */
  APPROVE_GOAL_SHEET: { MANAGER: REPORTS, HR_ADMIN: REPORTS, ORG_ADMIN: REPORTS },

  /** US-305 — returning a sheet is the other half of approving it. */
  RETURN_GOAL_SHEET: { MANAGER: REPORTS, HR_ADMIN: REPORTS, ORG_ADMIN: REPORTS },

  /** US-503 — adjust weightages inline before approving, with the employee notified. */
  ADJUST_WEIGHTAGE: { MANAGER: REPORTS, HR_ADMIN: REPORTS, ORG_ADMIN: REPORTS },

  /** US-506 — force-unlock in exceptional cases, and it is recorded. */
  FORCE_UNLOCK_SHEET: { HR_ADMIN: ANYONE_IN_ORG, ORG_ADMIN: ANYONE_IN_ORG },

  /** US-505 — delegate your own approvals while you are away, nobody else's. */
  DELEGATE_APPROVALS: { MANAGER: SELF, HR_ADMIN: SELF, ORG_ADMIN: SELF },

  /** US-601 — report your own achievement. */
  RECORD_CHECK_IN: {
    EMPLOYEE: SELF,
    MANAGER: SELF,
    HR_ADMIN: SELF,
    ORG_ADMIN: SELF,
  },

  /** US-602 — a threaded discussion needs both sides of it present. */
  COMMENT_ON_SHEET: {
    EMPLOYEE: SELF,
    MANAGER: SELF_AND_REPORTS,
    HR_ADMIN: ANYONE_IN_ORG,
    ORG_ADMIN: ANYONE_IN_ORG,
  },

  /** US-604 — the trend follows the same visibility as the sheet. */
  VIEW_PROGRESS_TREND: {
    EMPLOYEE: SELF,
    MANAGER: SELF_AND_REPORTS,
    HR_ADMIN: ANYONE_IN_ORG,
    ORG_ADMIN: ANYONE_IN_ORG,
  },

  /** US-701 — a self-appraisal nobody else can write is the only kind there is. */
  WRITE_SELF_APPRAISAL: {
    EMPLOYEE: SELF,
    MANAGER: SELF,
    HR_ADMIN: SELF,
    ORG_ADMIN: SELF,
  },

  /**
   * US-702 — rate a direct report, and only a direct report. A skip-level
   * manager influences the outcome through calibration, not by overwriting the
   * rating of someone they do not work with.
   */
  RATE_REPORT: {
    MANAGER: DIRECT_REPORT,
    HR_ADMIN: DIRECT_REPORT,
    ORG_ADMIN: DIRECT_REPORT,
  },

  /** US-703, US-704 — see the final rating and its justification. */
  VIEW_FINAL_RATING: {
    EMPLOYEE: SELF,
    MANAGER: SELF_AND_REPORTS,
    HR_ADMIN: ANYONE_IN_ORG,
    ORG_ADMIN: ANYONE_IN_ORG,
  },

  /** US-703 — acknowledgement is personal by definition. */
  ACKNOWLEDGE_RATING: {
    EMPLOYEE: SELF,
    MANAGER: SELF,
    HR_ADMIN: SELF,
    ORG_ADMIN: SELF,
  },

  /** US-801 — see the distribution across the managers below you. */
  VIEW_CALIBRATION: {
    MANAGER: REPORTS,
    HR_ADMIN: ANYONE_IN_ORG,
    ORG_ADMIN: ANYONE_IN_ORG,
  },

  /**
   * US-802 — adjust a rating during calibration with a mandatory reason.
   * `SELF` is excluded: calibration is not a route to your own rating.
   */
  ADJUST_RATING_IN_CALIBRATION: {
    HR_ADMIN: ANYONE_BUT_SELF,
    ORG_ADMIN: ANYONE_BUT_SELF,
  },

  /** US-803 — lock calibration and release results org-wide. */
  RELEASE_RESULTS: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /** US-903 — a live compliance dashboard for the current cycle. */
  VIEW_COMPLIANCE_DASHBOARD: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /** US-904 — resolve an escalation with a note so it stops notifying. */
  RESOLVE_ESCALATION: { HR_ADMIN: ANYONE_IN_ORG, ORG_ADMIN: ANYONE_IN_ORG },

  /** US-1001 — distribution analytics computed in the database. */
  VIEW_ANALYTICS: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /** US-1002 — export cycle data for offline analysis. */
  EXPORT_CYCLE_DATA: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /** US-1003 — a team rollup of progress and completion. */
  VIEW_TEAM_ROLLUP: {
    MANAGER: REPORTS,
    HR_ADMIN: ANYONE_IN_ORG,
    ORG_ADMIN: ANYONE_IN_ORG,
  },

  /** US-1101, US-1102 — the audit trail, searchable. */
  VIEW_AUDIT_TRAIL: { HR_ADMIN: ORG_WIDE, ORG_ADMIN: ORG_WIDE },

  /** US-1103 — every version of a goal sheet, diffable. */
  VIEW_SHEET_REVISIONS: {
    EMPLOYEE: SELF,
    MANAGER: SELF_AND_REPORTS,
    HR_ADMIN: ANYONE_IN_ORG,
    ORG_ADMIN: ANYONE_IN_ORG,
  },
};

export const DENIAL_REASONS = [
  'INACTIVE_ACTOR',
  'CROSS_ORG',
  'ROLE_NOT_PERMITTED',
  'RELATIONSHIP_NOT_PERMITTED',
] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];

export type PolicyDecision = {
  readonly allowed: boolean;
  readonly relationship: Relationship;
  /** `null` when allowed. Suitable for logging, not for showing verbatim. */
  readonly reason: DenialReason | null;
};

/**
 * How the actor stands to the resource's subject.
 *
 * Org-wide resources — those with no subject — resolve to `SAME_ORG`, which is
 * why org-wide actions list exactly that relationship and nothing else.
 */
export function relationshipOf(actor: Actor, resource: Resource): Relationship {
  if (actor.orgId !== resource.orgId) {
    return 'OTHER_ORG';
  }
  if (resource.subjectUserId === actor.userId) {
    return 'SELF';
  }
  if (resource.managerChainIds[0] === actor.userId) {
    return 'DIRECT_REPORT';
  }
  if (resource.managerChainIds.includes(actor.userId)) {
    return 'INDIRECT_REPORT';
  }
  return 'SAME_ORG';
}

/**
 * The full decision, with the reason it went the way it did.
 *
 * Checks run in order of how fundamental they are, so the reason reported is
 * the most basic one that applies: a deactivated user from another org is
 * refused for being deactivated, not for the org.
 */
export function check(actor: Actor, action: PolicyAction, resource: Resource): PolicyDecision {
  const relationship = relationshipOf(actor, resource);

  if (!actor.isActive) {
    return { allowed: false, relationship, reason: 'INACTIVE_ACTOR' };
  }

  // Tenancy is not a permission. No role grants it and no relationship
  // survives it (PRD US-105).
  if (relationship === 'OTHER_ORG') {
    return { allowed: false, relationship, reason: 'CROSS_ORG' };
  }

  const entries = actor.roles
    .map((role) => POLICY[action][role])
    .filter((permitted): permitted is readonly Relationship[] => permitted !== undefined);

  // No held role appears in this action's table at all — including the case of
  // an actor holding no roles, which is a user mid-invite.
  if (entries.length === 0) {
    return { allowed: false, relationship, reason: 'ROLE_NOT_PERMITTED' };
  }

  if (!entries.some((permitted) => permitted.includes(relationship))) {
    return { allowed: false, relationship, reason: 'RELATIONSHIP_NOT_PERMITTED' };
  }

  return { allowed: true, relationship, reason: null };
}

/** Whether the actor may perform the action. See {@link check} for why. */
export function can(actor: Actor, action: PolicyAction, resource: Resource): boolean {
  return check(actor, action, resource).allowed;
}
