import { CASCADE_SKIP_REASONS, MAX_GOALS_PER_SHEET, MIN_GOALS_PER_SHEET } from '@aura/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  acknowledgeRatingRequestSchema,
  activateCycleRequestSchema,
  adjustWeightageRequestSchema,
  apiErrorSchema,
  cascadePreviewResponseSchema,
  cascadeSkipReasonSchema,
  checkInRequestSchema,
  createCycleRequestSchema,
  createSharedGoalRequestSchema,
  createTeamRequestSchema,
  emailSchema,
  exportRequestSchema,
  forgotPasswordRequestSchema,
  goalInputSchema,
  goalSheetInputSchema,
  importUsersRequestSchema,
  instantSchema,
  inviteUserRequestSchema,
  listNotificationsQuerySchema,
  loginRequestSchema,
  managerRatingRequestSchema,
  paginationSchema,
  passwordSchema,
  ratingScaleSchema,
  resolveEscalationRequestSchema,
  returnSheetRequestSchema,
  signupRequestSchema,
  timeZoneSchema,
  updateUserRequestSchema,
  weightageSchema,
} from './index.js';

const ID = 'clw0000000000000000000000';
const OTHER_ID = 'clw1111111111111111111111';

/** The messages a rejection produced, so a test can say why it failed. */
const messagesFrom = (result: z.ZodSafeParseResult<unknown>): string[] =>
  result.success ? [] : result.error.issues.map((issue) => issue.message);

const goal = (weightage: number, title = 'Improve uptime') => ({
  thrustArea: 'OPERATIONAL_EXCELLENCE' as const,
  title,
  uom: 'PERCENT' as const,
  direction: 'HIGHER_IS_BETTER' as const,
  target: '99.95',
  weightage,
});

describe('common · identity and text', () => {
  it('lowercases and trims an email, because the unique index is case-sensitive', () => {
    expect(emailSchema.parse('  Priya.Sharma@Example.COM ')).toBe('priya.sharma@example.com');
  });

  it.each(['not-an-email', 'a@', '@b.com', ''])('rejects %o as an email', (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });

  it('requires a password of at least twelve characters', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('correct-horse-battery').success).toBe(true);
  });

  it('says how long a password must be, rather than just refusing', () => {
    expect(messagesFrom(passwordSchema.safeParse('short'))[0]).toContain('12');
  });
});

describe('common · instants', () => {
  it('parses an ISO instant into a real Date', () => {
    const parsed = instantSchema.parse('2026-04-16T00:00:00.000Z');

    expect(parsed).toBeInstanceOf(Date);
    expect(parsed.toISOString()).toBe('2026-04-16T00:00:00.000Z');
  });

  it.each(['2026-04-16', 'yesterday', '16/04/2026', ''])('rejects %o as an instant', (value) => {
    expect(instantSchema.safeParse(value).success).toBe(false);
  });
});

describe('common · timezone', () => {
  it.each(['UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata'])(
    'accepts %s',
    (value) => {
      expect(timeZoneSchema.safeParse(value).success).toBe(true);
    },
  );

  it('rejects a timezone the runtime does not know', () => {
    const result = timeZoneSchema.safeParse('Mars/Olympus_Mons');

    expect(result.success).toBe(false);
    expect(messagesFrom(result)[0]).toContain('IANA');
  });
});

describe('common · weightage', () => {
  it.each([0, 10, 33.33, 100])('accepts %s', (value) => {
    expect(weightageSchema.safeParse(value).success).toBe(true);
  });

  it.each([-1, 101])('rejects %s as out of range', (value) => {
    expect(weightageSchema.safeParse(value).success).toBe(false);
  });

  it('rejects more precision than Decimal(5, 2) can store', () => {
    // Storing 33.333 as 33.33 would make the sheet stop adding to 100 in the
    // database while the browser insisted it did.
    expect(weightageSchema.safeParse(33.333).success).toBe(false);
    expect(messagesFrom(weightageSchema.safeParse(33.333))[0]).toContain('decimal');
  });
});

describe('common · pagination and errors', () => {
  it('defaults the page size rather than leaving it undefined', () => {
    expect(paginationSchema.parse({})).toEqual({ limit: 25 });
  });

  it('caps the page size', () => {
    expect(paginationSchema.safeParse({ limit: 1000 }).success).toBe(false);
  });

  it('round-trips an error carrying per-field messages', () => {
    const error = {
      error: 'Validation failed',
      detail: 'The sheet was not saved.',
      fields: { 'goals.0.weightage': ['Below the 10% minimum.'] },
    };

    expect(apiErrorSchema.parse(error)).toEqual(error);
  });
});

describe('auth', () => {
  it('round-trips a signup', () => {
    const request = {
      organizationName: 'Aura Industries',
      name: 'Sam Patel',
      email: 'Sam@Example.com',
      password: 'correct-horse-battery-staple',
    };

    expect(signupRequestSchema.parse(request)).toEqual({
      ...request,
      email: 'sam@example.com',
    });
  });

  it('rejects a signup whose password is too short', () => {
    const result = signupRequestSchema.safeParse({
      organizationName: 'Aura',
      name: 'Sam',
      email: 'sam@example.com',
      password: 'short',
    });

    expect(result.success).toBe(false);
  });

  it('accepts any non-empty password at login', () => {
    // Rejecting a short one here leaks that the stored password is longer, and
    // locks out anyone whose password predates a raised minimum.
    expect(loginRequestSchema.safeParse({ email: 'a@b.com', password: 'old' }).success).toBe(true);
  });

  it('still requires a password to be present at login', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });

  it('normalises the email on a forgot-password request, so lookup matches signup', () => {
    expect(forgotPasswordRequestSchema.parse({ email: 'A@B.COM' })).toEqual({ email: 'a@b.com' });
  });
});

describe('user', () => {
  it('round-trips an invite, defaulting an unmanaged user to null', () => {
    expect(
      inviteUserRequestSchema.parse({
        name: 'Priya Sharma',
        email: 'priya@example.com',
        role: 'EMPLOYEE',
      }),
    ).toEqual({
      name: 'Priya Sharma',
      email: 'priya@example.com',
      role: 'EMPLOYEE',
      managerId: null,
      teamId: null,
    });
  });

  it('rejects a role outside the enum', () => {
    const result = inviteUserRequestSchema.safeParse({
      name: 'Priya',
      email: 'priya@example.com',
      role: 'SUPERUSER',
    });

    expect(result.success).toBe(false);
  });

  it('refuses an update that changes nothing', () => {
    const result = updateUserRequestSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(messagesFrom(result)[0]).toContain('at least one field');
  });

  it('accepts an update that clears the manager', () => {
    expect(updateUserRequestSchema.safeParse({ managerId: null }).success).toBe(true);
  });

  it('defaults a bulk import to writing, and accepts a dry run', () => {
    const rows = [{ name: 'Priya', email: 'priya@example.com', role: 'EMPLOYEE' as const }];

    expect(importUsersRequestSchema.parse({ rows })).toMatchObject({ dryRun: false });
    expect(importUsersRequestSchema.parse({ rows, dryRun: true })).toMatchObject({ dryRun: true });
  });

  it('rejects an empty import', () => {
    expect(importUsersRequestSchema.safeParse({ rows: [] }).success).toBe(false);
  });

  it('references an importing manager by email, since spreadsheets have no ids', () => {
    const parsed = importUsersRequestSchema.parse({
      rows: [
        {
          name: 'Priya',
          email: 'priya@example.com',
          role: 'EMPLOYEE',
          managerEmail: 'MARCUS@example.com',
        },
      ],
    });

    expect(parsed.rows[0]?.managerEmail).toBe('marcus@example.com');
  });
});

describe('cycle', () => {
  const phase = (key: string, startsAt: string, endsAt: string) => ({
    key,
    label: key,
    startsAt,
    endsAt,
  });

  const validCycle = {
    name: 'FY27',
    fiscalYear: 2026,
    timeZone: 'Europe/London',
    phases: [
      phase('GOAL_SETTING', '2026-04-01T00:00:00.000Z', '2026-04-16T00:00:00.000Z'),
      phase('CHECK_IN', '2026-07-01T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
    ],
    ratingScale: { min: 1, max: 3, labels: { '1': 'Below', '2': 'Meets', '3': 'Exceeds' } },
    escalationRules: { manager: 3, skipLevelHr: 7, rules: ['GOALS_NOT_SUBMITTED'] },
  };

  it('round-trips a well-formed cycle, with phase dates as Dates', () => {
    const parsed = createCycleRequestSchema.parse(validCycle);

    expect(parsed.phases).toHaveLength(2);
    expect(parsed.phases[0]?.startsAt).toBeInstanceOf(Date);
  });

  describe('the self-appraisal deadline (US-702)', () => {
    const withAppraisal = {
      ...validCycle,
      phases: [phase('APPRAISAL', '2026-10-01T00:00:00.000Z', '2026-10-16T00:00:00.000Z')],
    };

    it('is optional, because waiting for the submission is a valid choice', () => {
      expect(createCycleRequestSchema.safeParse(withAppraisal).success).toBe(true);
    });

    it('accepts a deadline inside the appraisal window', () => {
      const result = createCycleRequestSchema.safeParse({
        ...withAppraisal,
        selfAppraisalDueAt: '2026-10-08T00:00:00.000Z',
      });

      expect(result.success).toBe(true);
    });

    it('accepts the window boundaries themselves', () => {
      for (const due of ['2026-10-01T00:00:00.000Z', '2026-10-16T00:00:00.000Z']) {
        expect(
          createCycleRequestSchema.safeParse({ ...withAppraisal, selfAppraisalDueAt: due }).success,
        ).toBe(true);
      }
    });

    it('rejects a deadline before the window opens', () => {
      // Before the phase starts, the deadline has always passed -- so the
      // manager could rate from the first day and the gate would never bite.
      const result = createCycleRequestSchema.safeParse({
        ...withAppraisal,
        selfAppraisalDueAt: '2026-09-20T00:00:00.000Z',
      });

      expect(messagesFrom(result)).toContain(
        'The self-appraisal deadline must fall inside the appraisal phase.',
      );
    });

    it('rejects a deadline after the window closes', () => {
      // After the phase ends, the deadline never arrives inside a window where
      // anyone could act on it.
      const result = createCycleRequestSchema.safeParse({
        ...withAppraisal,
        selfAppraisalDueAt: '2026-11-20T00:00:00.000Z',
      });

      expect(messagesFrom(result)).toContain(
        'The self-appraisal deadline must fall inside the appraisal phase.',
      );
    });

    it('rejects a deadline on a cycle with no appraisal phase', () => {
      const result = createCycleRequestSchema.safeParse({
        ...validCycle,
        selfAppraisalDueAt: '2026-10-08T00:00:00.000Z',
      });

      expect(messagesFrom(result)).toContain(
        'A self-appraisal deadline needs an appraisal phase to fall inside.',
      );
    });
  });

  it('accepts phases that meet exactly, which is adjacency and not overlap', () => {
    const result = createCycleRequestSchema.safeParse({
      ...validCycle,
      phases: [
        phase('APPRAISAL', '2026-10-01T00:00:00.000Z', '2026-10-16T00:00:00.000Z'),
        phase('CALIBRATION', '2026-10-16T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects overlapping phases, using the same check the resolver uses', () => {
    const result = createCycleRequestSchema.safeParse({
      ...validCycle,
      phases: [
        phase('APPRAISAL', '2026-10-01T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
        phase('CALIBRATION', '2026-10-16T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
      ],
    });

    expect(result.success).toBe(false);
    expect(messagesFrom(result).join(' ')).toContain('overlaps');
  });

  it('rejects the same phase declared twice', () => {
    const result = createCycleRequestSchema.safeParse({
      ...validCycle,
      phases: [
        phase('CHECK_IN', '2026-07-01T00:00:00.000Z', '2026-07-16T00:00:00.000Z'),
        phase('CHECK_IN', '2026-08-01T00:00:00.000Z', '2026-08-16T00:00:00.000Z'),
      ],
    });

    expect(result.success).toBe(false);
    expect(messagesFrom(result).join(' ')).toContain('only once');
  });

  it('rejects a phase that ends before it starts', () => {
    const result = createCycleRequestSchema.safeParse({
      ...validCycle,
      phases: [phase('CHECK_IN', '2026-07-16T00:00:00.000Z', '2026-07-01T00:00:00.000Z')],
    });

    expect(result.success).toBe(false);
    expect(messagesFrom(result)[0]).toContain('end after it starts');
  });

  it('rejects a rating scale with a missing label', () => {
    const result = ratingScaleSchema.safeParse({ min: 1, max: 5, labels: { '1': 'Below' } });

    expect(result.success).toBe(false);
    expect(messagesFrom(result)[0]).toContain('label');
  });

  it('rejects inverted escalation thresholds', () => {
    const result = createCycleRequestSchema.safeParse({
      ...validCycle,
      escalationRules: { manager: 9, skipLevelHr: 2, rules: ['GOALS_NOT_SUBMITTED'] },
    });

    expect(result.success).toBe(false);
  });

  it('requires activation to be confirmed explicitly', () => {
    expect(activateCycleRequestSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(activateCycleRequestSchema.safeParse({ confirm: true }).success).toBe(true);
  });
});

describe('goal sheet · the weightage rules come from @aura/core', () => {
  const sheet = (...weightages: number[]) => ({
    cycleId: ID,
    goals: weightages.map((weightage, index) => goal(weightage, `Goal ${String(index + 1)}`)),
  });

  it('accepts a sheet totalling exactly 100', () => {
    expect(goalSheetInputSchema.safeParse(sheet(34, 33, 33)).success).toBe(true);
  });

  it('accepts the float-residue split that a strict !== 100 would reject', () => {
    // 10 + 58.01 + 31.99 sums to 99.999999999999985789 in IEEE 754.
    expect(goalSheetInputSchema.safeParse(sheet(10, 58.01, 31.99)).success).toBe(true);
  });

  it('rejects a sheet that does not add up, and says by how much', () => {
    const result = goalSheetInputSchema.safeParse(sheet(30, 30, 30));

    expect(result.success).toBe(false);
    expect(messagesFrom(result).join(' ')).toContain('90');
  });

  it('rejects a goal below the minimum weightage, and points at that goal', () => {
    const result = goalSheetInputSchema.safeParse(sheet(85, 10, 5));

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual(['goals', 2, 'weightage']);
  });

  it('names the offending goal by its title', () => {
    const result = goalSheetInputSchema.safeParse(sheet(85, 10, 5));

    expect(messagesFrom(result).join(' ')).toContain('Goal 3');
  });

  it('rejects too few goals on the array itself, not as a total mismatch', () => {
    // Weightages chosen to total 100 exactly, so the count is the only fault.
    const result = goalSheetInputSchema.safeParse(sheet(50, 50));

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual(['goals']);
    expect(messagesFrom(result)[0]).toContain(String(MIN_GOALS_PER_SHEET));
  });

  it('rejects too many goals on the array itself', () => {
    // Nine goals at 11.11 total 99.99 — inside the tolerance, so again the
    // count is the only fault. Note 100/9 would not be: 11.111... has more
    // decimals than Decimal(5, 2) stores, and that rule fires first.
    const result = goalSheetInputSchema.safeParse(sheet(...Array<number>(9).fill(11.11)));

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual(['goals']);
    expect(messagesFrom(result)[0]).toContain(String(MAX_GOALS_PER_SHEET));
  });

  it('rejects a weightage with more precision than the column stores', () => {
    const result = goalSheetInputSchema.safeParse(sheet(33.333, 33.333, 33.334));

    expect(result.success).toBe(false);
    expect(messagesFrom(result).join(' ')).toContain('decimal');
  });

  it('requires a direction, with no default to guess it', () => {
    // PLAN.md F-06: the prototype inferred this from the title.
    const { direction: _direction, ...withoutDirection } = goal(100);
    const result = goalInputSchema.safeParse(withoutDirection);

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues[0]?.path).toEqual(['direction']);
  });

  it('accepts either direction on identical numbers', () => {
    expect(goalInputSchema.safeParse({ ...goal(50), direction: 'LOWER_IS_BETTER' }).success).toBe(
      true,
    );
  });
});

describe('goal sheet · the mutations a check-in may make', () => {
  it('accepts an achievement update', () => {
    expect(
      checkInRequestSchema.safeParse({
        updates: [{ goalId: ID, actualAchievement: '99.98', status: 'ON_TRACK' }],
      }).success,
    ).toBe(true);
  });

  it('drops target and weightage rather than letting a check-in rewrite them', () => {
    // PLAN.md F-04: the prototype's check-in route trusted the client's whole
    // payload and wrote it over an approved sheet.
    const parsed = checkInRequestSchema.parse({
      updates: [
        {
          goalId: ID,
          actualAchievement: '99.98',
          status: 'ON_TRACK',
          target: '1',
          weightage: 99,
        },
      ],
    });

    expect(parsed.updates[0]).toEqual({
      goalId: ID,
      actualAchievement: '99.98',
      status: 'ON_TRACK',
    });
  });

  it('rejects an empty check-in', () => {
    expect(checkInRequestSchema.safeParse({ updates: [] }).success).toBe(false);
  });

  it('requires a reason when returning a sheet', () => {
    expect(returnSheetRequestSchema.safeParse({ goalIds: [ID] }).success).toBe(false);
    expect(returnSheetRequestSchema.parse({ reason: 'Weightages do not add up.' })).toEqual({
      reason: 'Weightages do not add up.',
      goalIds: [],
    });
  });

  it('refuses to adjust the same goal twice in one request', () => {
    const result = adjustWeightageRequestSchema.safeParse({
      adjustments: [
        { goalId: ID, weightage: 40 },
        { goalId: ID, weightage: 60 },
      ],
      note: 'Rebalanced.',
    });

    expect(result.success).toBe(false);
    expect(messagesFrom(result)[0]).toContain('only once');
  });

  it('requires a note on a weightage adjustment, since the employee is told', () => {
    expect(
      adjustWeightageRequestSchema.safeParse({ adjustments: [{ goalId: ID, weightage: 40 }] })
        .success,
    ).toBe(false);
  });
});

describe('teams', () => {
  it('defaults a new team to no lead and no parent', () => {
    expect(createTeamRequestSchema.parse({ name: 'Platform' })).toEqual({
      name: 'Platform',
      leadId: null,
      parentTeamId: null,
    });
  });

  it('rejects a lead given as a name', () => {
    expect(createTeamRequestSchema.safeParse({ name: 'Platform', leadId: 'Marcus' }).success).toBe(
      false,
    );
  });
});

describe('shared goals and appraisal', () => {
  const sharedGoal = {
    cycleId: ID,
    ownerUserId: OTHER_ID,
    thrustArea: 'BUSINESS_GROWTH' as const,
    title: 'Grow ARR',
    uom: 'NUMERIC' as const,
    direction: 'HIGHER_IS_BETTER' as const,
    target: '1000000',
    defaultWeightage: 20,
    audience: { kind: 'TEAM' as const, teamId: ID, includeSubTeams: false },
  };

  it('takes a shared goal owner by id, never by name', () => {
    expect(createSharedGoalRequestSchema.parse(sharedGoal)).toEqual(sharedGoal);
  });

  it('rejects an owner given as a display name', () => {
    expect(
      createSharedGoalRequestSchema.safeParse({ ...sharedGoal, ownerUserId: 'Marcus Chen' })
        .success,
    ).toBe(false);
  });

  it('has no "everyone" audience to choose', () => {
    // The prototype resolved its audience by scanning every record it could
    // find (PLAN.md F-05). The absence of this option is the fix; a test that
    // only checked the three valid kinds would not notice a fourth appearing.
    expect(
      createSharedGoalRequestSchema.safeParse({
        ...sharedGoal,
        audience: { kind: 'EVERYONE' },
      }).success,
    ).toBe(false);
  });

  it('accepts each of the three audiences and nothing else', () => {
    for (const audience of [
      { kind: 'TEAM' as const, teamId: ID, includeSubTeams: true },
      { kind: 'ROLE' as const, role: 'EMPLOYEE' as const },
      { kind: 'USERS' as const, userIds: [ID, OTHER_ID] },
    ]) {
      expect(createSharedGoalRequestSchema.safeParse({ ...sharedGoal, audience }).success).toBe(
        true,
      );
    }
  });

  it('keeps sub-teams out of a team cascade unless asked', () => {
    const parsed = createSharedGoalRequestSchema.parse({
      ...sharedGoal,
      audience: { kind: 'TEAM', teamId: ID },
    });

    expect(parsed.audience).toEqual({ kind: 'TEAM', teamId: ID, includeSubTeams: false });
  });

  it('draws its skip reasons from @aura/core rather than restating them', () => {
    // The schema this replaced held its own copy of the list, so a reason
    // added to core would have been rejected here while the server produced it.
    expect(cascadeSkipReasonSchema.parse('SHEET_NOT_EDITABLE')).toBe('SHEET_NOT_EDITABLE');
    expect(cascadeSkipReasonSchema.parse('NOT_IN_YOUR_LINE')).toBe('NOT_IN_YOUR_LINE');
    expect(cascadeSkipReasonSchema.options).toEqual([...CASCADE_SKIP_REASONS]);
  });

  it('round-trips a cascade preview with named people on both sides', () => {
    const preview = {
      weightage: 20,
      willReceive: [{ userId: OTHER_ID, name: 'Priya', email: 'priya@example.com' }],
      skipped: [
        {
          userId: ID,
          name: 'Marcus',
          email: 'marcus@example.com',
          reason: 'IS_OWNER' as const,
          detail: 'Owns this goal already.',
        },
      ],
    };

    expect(cascadePreviewResponseSchema.parse(preview)).toEqual(preview);
  });

  it('requires a justification on a manager rating', () => {
    const ratings = [{ goalId: ID, rating: 4, commentary: 'Consistently strong.' }];

    expect(
      managerRatingRequestSchema.safeParse({ ratings, overallRating: 4 }).success,
    ).toBe(false);
    expect(
      managerRatingRequestSchema.safeParse({
        ratings,
        overallRating: 4,
        justification: 'Exceeded on three of four goals.',
      }).success,
    ).toBe(true);
  });

  it('accepts an acknowledgement, with or without a comment', () => {
    expect(acknowledgeRatingRequestSchema.safeParse({ acknowledged: true }).success).toBe(true);
    expect(
      acknowledgeRatingRequestSchema.safeParse({ acknowledged: true, comment: 'I disagree.' })
        .success,
    ).toBe(true);
  });

  it('has no way to acknowledge false, which would mean nothing', () => {
    expect(acknowledgeRatingRequestSchema.safeParse({ acknowledged: false }).success).toBe(false);
  });
});

describe('compliance and export', () => {
  it('requires a note to resolve an escalation', () => {
    expect(resolveEscalationRequestSchema.safeParse({}).success).toBe(false);
    expect(resolveEscalationRequestSchema.safeParse({ note: 'Sheet submitted late.' }).success).toBe(
      true,
    );
  });

  it('defaults notification listing to everything, not just unread', () => {
    expect(listNotificationsQuerySchema.parse({})).toEqual({ limit: 25, unreadOnly: false });
  });

  it('requires an export to name its columns', () => {
    expect(exportRequestSchema.safeParse({ cycleId: ID, columns: [] }).success).toBe(false);
  });

  it('defaults an export to CSV without ratings', () => {
    expect(exportRequestSchema.parse({ cycleId: ID, columns: ['title'] })).toEqual({
      cycleId: ID,
      columns: ['title'],
      format: 'csv',
      includeRatings: false,
    });
  });
});

describe('every rejection says something useful', () => {
  const rejections = [
    signupRequestSchema.safeParse({}),
    inviteUserRequestSchema.safeParse({}),
    createCycleRequestSchema.safeParse({}),
    goalSheetInputSchema.safeParse({ cycleId: ID, goals: [] }),
    checkInRequestSchema.safeParse({}),
    exportRequestSchema.safeParse({}),
  ];

  it.each(rejections.map((result, index) => [index, result]))(
    'schema %i reports at least one non-empty message with a path',
    (_index, result) => {
      expect(result.success).toBe(false);
      const issues = result.success ? [] : result.error.issues;

      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) {
        expect(issue.message.length).toBeGreaterThan(0);
      }
    },
  );
});
