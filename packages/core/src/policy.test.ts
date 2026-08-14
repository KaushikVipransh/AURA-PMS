import { describe, expect, it } from 'vitest';

import {
  POLICY,
  POLICY_ACTIONS,
  RELATIONSHIPS,
  ROLES,
  can,
  check,
  relationshipOf,
  type Actor,
  type PolicyAction,
  type Relationship,
  type Resource,
  type Role,
} from './policy.js';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';

const actorFor = (role: Role, isActive = true): Actor => ({
  userId: 'actor',
  orgId: ORG,
  roles: [role],
  isActive,
});

const actorWith = (...roles: readonly Role[]): Actor => ({
  userId: 'actor',
  orgId: ORG,
  roles,
  isActive: true,
});

/** A resource standing in each possible relation to `actor`. */
const RESOURCES: Readonly<Record<Relationship, Resource>> = {
  SELF: { orgId: ORG, subjectUserId: 'actor', managerChainIds: ['their-boss'] },
  DIRECT_REPORT: { orgId: ORG, subjectUserId: 'report', managerChainIds: ['actor', 'grandboss'] },
  INDIRECT_REPORT: {
    orgId: ORG,
    subjectUserId: 'grandchild',
    managerChainIds: ['middle-manager', 'actor'],
  },
  SAME_ORG: { orgId: ORG, subjectUserId: 'stranger', managerChainIds: ['someone-else'] },
  OTHER_ORG: { orgId: OTHER_ORG, subjectUserId: 'outsider', managerChainIds: [] },
};

/**
 * The expectation table, written out from the PRD stories rather than read
 * back off POLICY. Every `role/relationship` pair not listed for an action is
 * expected to be refused.
 */
type Grant = `${Role}/${Relationship}`;

const grants = (role: Role, ...relationships: readonly Relationship[]): Grant[] =>
  relationships.map((relationship) => `${role}/${relationship}` as const);

/** Only ever about yourself, whoever you are. */
const selfOnly = (): Grant[] => ROLES.flatMap((role) => grants(role, 'SELF'));

/** You, your chain below you, and everyone if you administer the org. */
const chainVisibility = (): Grant[] => [
  ...grants('EMPLOYEE', 'SELF'),
  ...grants('MANAGER', 'SELF', 'DIRECT_REPORT', 'INDIRECT_REPORT'),
  ...grants('HR_ADMIN', 'SELF', 'DIRECT_REPORT', 'INDIRECT_REPORT', 'SAME_ORG'),
  ...grants('ORG_ADMIN', 'SELF', 'DIRECT_REPORT', 'INDIRECT_REPORT', 'SAME_ORG'),
];

const adminOrgWide = (): Grant[] => [
  ...grants('HR_ADMIN', 'SAME_ORG'),
  ...grants('ORG_ADMIN', 'SAME_ORG'),
];

const adminAnyone = (): Grant[] => [
  ...grants('HR_ADMIN', 'SELF', 'DIRECT_REPORT', 'INDIRECT_REPORT', 'SAME_ORG'),
  ...grants('ORG_ADMIN', 'SELF', 'DIRECT_REPORT', 'INDIRECT_REPORT', 'SAME_ORG'),
];

const adminAnyoneButSelf = (): Grant[] => [
  ...grants('HR_ADMIN', 'DIRECT_REPORT', 'INDIRECT_REPORT', 'SAME_ORG'),
  ...grants('ORG_ADMIN', 'DIRECT_REPORT', 'INDIRECT_REPORT', 'SAME_ORG'),
];

/** Anyone above the subject in the reporting line, and never the subject. */
const approvalChain = (): Grant[] => [
  ...grants('MANAGER', 'DIRECT_REPORT', 'INDIRECT_REPORT'),
  ...grants('HR_ADMIN', 'DIRECT_REPORT', 'INDIRECT_REPORT'),
  ...grants('ORG_ADMIN', 'DIRECT_REPORT', 'INDIRECT_REPORT'),
];

const EXPECTED: Readonly<Record<PolicyAction, readonly Grant[]>> = {
  INVITE_USER: adminOrgWide(),
  BULK_IMPORT_USERS: adminOrgWide(),
  DEACTIVATE_USER: adminAnyoneButSelf(),
  VIEW_USER: chainVisibility(),
  MANAGE_TEAM: adminOrgWide(),
  CREATE_CYCLE: adminOrgWide(),
  CONFIGURE_CYCLE: adminOrgWide(),

  CREATE_GOAL_SHEET: selfOnly(),
  EDIT_GOAL_SHEET: selfOnly(),
  DELETE_GOAL: selfOnly(),
  SUBMIT_GOAL_SHEET: selfOnly(),
  VIEW_GOAL_SHEET: chainVisibility(),

  CASCADE_SHARED_GOAL: [
    ...grants('MANAGER', 'DIRECT_REPORT', 'INDIRECT_REPORT'),
    ...adminAnyoneButSelf(),
  ],
  APPROVE_GOAL_SHEET: approvalChain(),
  RETURN_GOAL_SHEET: approvalChain(),
  ADJUST_WEIGHTAGE: approvalChain(),
  FORCE_UNLOCK_SHEET: adminAnyone(),
  DELEGATE_APPROVALS: [
    ...grants('MANAGER', 'SELF'),
    ...grants('HR_ADMIN', 'SELF'),
    ...grants('ORG_ADMIN', 'SELF'),
  ],

  RECORD_CHECK_IN: selfOnly(),
  COMMENT_ON_SHEET: chainVisibility(),
  VIEW_PROGRESS_TREND: chainVisibility(),

  WRITE_SELF_APPRAISAL: selfOnly(),
  RATE_REPORT: [
    ...grants('MANAGER', 'DIRECT_REPORT'),
    ...grants('HR_ADMIN', 'DIRECT_REPORT'),
    ...grants('ORG_ADMIN', 'DIRECT_REPORT'),
  ],
  VIEW_FINAL_RATING: chainVisibility(),
  ACKNOWLEDGE_RATING: selfOnly(),

  VIEW_CALIBRATION: [...grants('MANAGER', 'DIRECT_REPORT', 'INDIRECT_REPORT'), ...adminAnyone()],
  ADJUST_RATING_IN_CALIBRATION: adminAnyoneButSelf(),
  RELEASE_RESULTS: adminOrgWide(),

  VIEW_COMPLIANCE_DASHBOARD: adminOrgWide(),
  RESOLVE_ESCALATION: adminAnyone(),

  VIEW_ANALYTICS: adminOrgWide(),
  EXPORT_CYCLE_DATA: adminOrgWide(),
  VIEW_TEAM_ROLLUP: [...grants('MANAGER', 'DIRECT_REPORT', 'INDIRECT_REPORT'), ...adminAnyone()],

  VIEW_AUDIT_TRAIL: adminOrgWide(),
  VIEW_SHEET_REVISIONS: chainVisibility(),
};

describe('relationshipOf', () => {
  it('recognises the actor as themselves', () => {
    expect(relationshipOf(actorFor('EMPLOYEE'), RESOURCES.SELF)).toBe('SELF');
  });

  it('recognises the first link in the chain as a direct report', () => {
    expect(relationshipOf(actorFor('MANAGER'), RESOURCES.DIRECT_REPORT)).toBe('DIRECT_REPORT');
  });

  it('recognises a later link as an indirect report', () => {
    expect(relationshipOf(actorFor('MANAGER'), RESOURCES.INDIRECT_REPORT)).toBe('INDIRECT_REPORT');
  });

  it('recognises a colleague with no reporting line between them', () => {
    expect(relationshipOf(actorFor('MANAGER'), RESOURCES.SAME_ORG)).toBe('SAME_ORG');
  });

  it('treats an empty chain as merely a colleague', () => {
    const orphan: Resource = { orgId: ORG, subjectUserId: 'nobody', managerChainIds: [] };

    expect(relationshipOf(actorFor('MANAGER'), orphan)).toBe('SAME_ORG');
  });

  it('treats an org-wide resource with no subject as org scope', () => {
    const orgWide: Resource = { orgId: ORG, subjectUserId: null, managerChainIds: [] };

    expect(relationshipOf(actorFor('HR_ADMIN'), orgWide)).toBe('SAME_ORG');
  });

  it('puts another org above every other consideration', () => {
    // Same user id, different org. Tenancy is checked before identity, so this
    // is a stranger and not a self-access (PRD US-105).
    const impostor: Resource = {
      orgId: OTHER_ORG,
      subjectUserId: 'actor',
      managerChainIds: ['actor'],
    };

    expect(relationshipOf(actorFor('ORG_ADMIN'), impostor)).toBe('OTHER_ORG');
  });

  it('prefers self over a reporting relationship when the data says both', () => {
    // A malformed chain listing the subject as their own manager. Deterministic
    // rather than arbitrary.
    const selfManaged: Resource = {
      orgId: ORG,
      subjectUserId: 'actor',
      managerChainIds: ['actor'],
    };

    expect(relationshipOf(actorFor('EMPLOYEE'), selfManaged)).toBe('SELF');
  });
});

describe('can · the full role x action x relationship grid', () => {
  it.each(POLICY_ACTIONS)('%s matches the expectation table', (action) => {
    for (const role of ROLES) {
      for (const relationship of RELATIONSHIPS) {
        const expected = EXPECTED[action].includes(`${role}/${relationship}`);

        expect(
          can(actorFor(role), action, RESOURCES[relationship]),
          `${action} for ${role} over ${relationship}`,
        ).toBe(expected);
      }
    }
  });

  it('covers every cell', () => {
    expect(POLICY_ACTIONS.length * ROLES.length * RELATIONSHIPS.length).toBe(
      POLICY_ACTIONS.length * 20,
    );
    expect(POLICY_ACTIONS.length).toBeGreaterThanOrEqual(30);
  });
});

describe('tenancy is not a permission', () => {
  it('refuses every action across an org boundary, for every role', () => {
    for (const action of POLICY_ACTIONS) {
      for (const role of ROLES) {
        expect(can(actorFor(role), action, RESOURCES.OTHER_ORG)).toBe(false);
      }
    }
  });

  it('names the org boundary as the reason', () => {
    expect(check(actorFor('ORG_ADMIN'), 'VIEW_USER', RESOURCES.OTHER_ORG).reason).toBe('CROSS_ORG');
  });

  it('is granted by no entry in the table', () => {
    for (const action of POLICY_ACTIONS) {
      for (const role of ROLES) {
        expect(POLICY[action][role] ?? []).not.toContain('OTHER_ORG');
      }
    }
  });
});

describe('a deactivated user keeps their history and loses their access', () => {
  it('is refused everything, whatever their role and whatever the resource', () => {
    for (const action of POLICY_ACTIONS) {
      for (const role of ROLES) {
        for (const relationship of RELATIONSHIPS) {
          expect(can(actorFor(role, false), action, RESOURCES[relationship])).toBe(false);
        }
      }
    }
  });

  it('is refused for being deactivated first, ahead of any other reason', () => {
    const decision = check(actorFor('ORG_ADMIN', false), 'VIEW_USER', RESOURCES.OTHER_ORG);

    expect(decision.reason).toBe('INACTIVE_ACTOR');
  });
});

describe('nobody signs off their own work', () => {
  const selfDealing: readonly PolicyAction[] = [
    'APPROVE_GOAL_SHEET',
    'RETURN_GOAL_SHEET',
    'ADJUST_WEIGHTAGE',
    'RATE_REPORT',
    'ADJUST_RATING_IN_CALIBRATION',
    'DEACTIVATE_USER',
  ];

  it.each(selfDealing)('refuses %s over oneself, for every role including ORG_ADMIN', (action) => {
    for (const role of ROLES) {
      expect(can(actorFor(role), action, RESOURCES.SELF)).toBe(false);
    }
  });

  it('lets the same roles do it to a report', () => {
    // Proving the refusals above are about the relationship, not a blanket ban.
    expect(can(actorFor('MANAGER'), 'APPROVE_GOAL_SHEET', RESOURCES.DIRECT_REPORT)).toBe(true);
    expect(can(actorFor('MANAGER'), 'RATE_REPORT', RESOURCES.DIRECT_REPORT)).toBe(true);
    expect(can(actorFor('HR_ADMIN'), 'DEACTIVATE_USER', RESOURCES.SAME_ORG)).toBe(true);
  });

  it('keeps a skip-level manager out of the rating itself', () => {
    // US-802: influence the outcome through calibration, not by overwriting a
    // rating for someone you do not work with.
    expect(can(actorFor('MANAGER'), 'RATE_REPORT', RESOURCES.INDIRECT_REPORT)).toBe(false);
    expect(can(actorFor('MANAGER'), 'VIEW_CALIBRATION', RESOURCES.INDIRECT_REPORT)).toBe(true);
  });
});

describe('an employee reaches nothing beyond themselves', () => {
  it.each(POLICY_ACTIONS)('grants EMPLOYEE nothing but SELF on %s', (action) => {
    for (const relationship of RELATIONSHIPS) {
      if (relationship === 'SELF') {
        continue;
      }
      expect(can(actorFor('EMPLOYEE'), action, RESOURCES[relationship])).toBe(false);
    }
  });
});

describe('the roles form a ladder', () => {
  const permittedSet = (action: PolicyAction, role: Role): Set<Relationship> =>
    new Set(POLICY[action][role] ?? []);

  const isSuperset = (bigger: Set<Relationship>, smaller: Set<Relationship>): boolean =>
    [...smaller].every((relationship) => bigger.has(relationship));

  it.each<[Role, Role]>([
    ['MANAGER', 'EMPLOYEE'],
    ['HR_ADMIN', 'MANAGER'],
    ['ORG_ADMIN', 'HR_ADMIN'],
  ])('%s can do everything %s can', (higher, lower) => {
    for (const action of POLICY_ACTIONS) {
      expect(
        isSuperset(permittedSet(action, higher), permittedSet(action, lower)),
        `${higher} is missing something ${lower} has on ${action}`,
      ).toBe(true);
    }
  });

  it('does not make the ladder pointless — higher roles genuinely gain reach', () => {
    const gains = POLICY_ACTIONS.filter(
      (action) => permittedSet(action, 'HR_ADMIN').size > permittedSet(action, 'MANAGER').size,
    );

    expect(gains.length).toBeGreaterThan(0);
  });
});

describe('the table itself', () => {
  it('grants every action to at least one role', () => {
    for (const action of POLICY_ACTIONS) {
      expect(Object.keys(POLICY[action]).length).toBeGreaterThan(0);
    }
  });

  it('never lists an empty relationship set, which would be a silent denial', () => {
    for (const action of POLICY_ACTIONS) {
      for (const role of ROLES) {
        const permitted = POLICY[action][role];

        if (permitted !== undefined) {
          expect(permitted.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('has an expectation written for every action, and no stale ones', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...POLICY_ACTIONS].sort());
  });
});

describe('a user holds several roles at once', () => {
  it('lets an HR admin submit their own goal sheet, which HR_ADMIN alone permits anyway', () => {
    expect(can(actorWith('HR_ADMIN', 'EMPLOYEE'), 'SUBMIT_GOAL_SHEET', RESOURCES.SELF)).toBe(true);
  });

  it('grants the union of what the held roles permit', () => {
    // MANAGER cannot invite; HR_ADMIN can. Holding both, they can.
    expect(can(actorFor('MANAGER'), 'INVITE_USER', RESOURCES.SAME_ORG)).toBe(false);
    expect(can(actorWith('MANAGER', 'HR_ADMIN'), 'INVITE_USER', RESOURCES.SAME_ORG)).toBe(true);
  });

  it('unions the relationships too, not just the actions', () => {
    // EMPLOYEE reaches only SELF; MANAGER reaches reports. Both together reach
    // both, which is the union and not the second list replacing the first.
    const both = actorWith('EMPLOYEE', 'MANAGER');

    expect(can(both, 'VIEW_GOAL_SHEET', RESOURCES.SELF)).toBe(true);
    expect(can(both, 'VIEW_GOAL_SHEET', RESOURCES.DIRECT_REPORT)).toBe(true);
    expect(can(both, 'VIEW_GOAL_SHEET', RESOURCES.SAME_ORG)).toBe(false);
  });

  it('still refuses what no held role permits', () => {
    expect(can(actorWith('EMPLOYEE', 'MANAGER'), 'VIEW_AUDIT_TRAIL', RESOURCES.SAME_ORG)).toBe(
      false,
    );
  });

  it('never lets a second role unlock self-dealing', () => {
    // Holding every role in the system still does not let you approve your own
    // sheet or rate yourself -- the exclusion is on the relationship.
    const everything = actorWith(...ROLES);

    expect(can(everything, 'APPROVE_GOAL_SHEET', RESOURCES.SELF)).toBe(false);
    expect(can(everything, 'RATE_REPORT', RESOURCES.SELF)).toBe(false);
    expect(can(everything, 'DEACTIVATE_USER', RESOURCES.SELF)).toBe(false);
  });

  it('refuses everything to an actor holding no roles at all', () => {
    // A user mid-invite: the row exists, the roles array is empty.
    const pending = actorWith();

    for (const action of POLICY_ACTIONS) {
      expect(can(pending, action, RESOURCES.SELF)).toBe(false);
    }
    expect(check(pending, 'VIEW_GOAL_SHEET', RESOURCES.SELF).reason).toBe('ROLE_NOT_PERMITTED');
  });

  it('refuses a cross-org request however many roles are held', () => {
    expect(can(actorWith(...ROLES), 'VIEW_USER', RESOURCES.OTHER_ORG)).toBe(false);
  });

  it('refuses a deactivated user however many roles are held', () => {
    const deactivated: Actor = { ...actorWith(...ROLES), isActive: false };

    expect(can(deactivated, 'VIEW_GOAL_SHEET', RESOURCES.SELF)).toBe(false);
  });
});

describe('check · reasons', () => {
  it('reports no reason when allowed', () => {
    const decision = check(actorFor('EMPLOYEE'), 'VIEW_GOAL_SHEET', RESOURCES.SELF);

    expect(decision).toEqual({ allowed: true, relationship: 'SELF', reason: null });
  });

  it('distinguishes a role that may never act from a relationship that is too distant', () => {
    expect(check(actorFor('EMPLOYEE'), 'APPROVE_GOAL_SHEET', RESOURCES.DIRECT_REPORT).reason).toBe(
      'ROLE_NOT_PERMITTED',
    );
    expect(check(actorFor('MANAGER'), 'APPROVE_GOAL_SHEET', RESOURCES.SELF).reason).toBe(
      'RELATIONSHIP_NOT_PERMITTED',
    );
  });

  it('carries the relationship it computed, so a denial can be explained', () => {
    expect(check(actorFor('MANAGER'), 'RATE_REPORT', RESOURCES.INDIRECT_REPORT)).toEqual({
      allowed: false,
      relationship: 'INDIRECT_REPORT',
      reason: 'RELATIONSHIP_NOT_PERMITTED',
    });
  });
});
