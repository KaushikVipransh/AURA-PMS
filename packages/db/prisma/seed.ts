import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Seed a realistic organization.
 *
 * Two properties this script guarantees, both load-bearing:
 *
 * - **Deterministic.** Every id is written explicitly, never generated. Two
 *   runs on two machines produce byte-identical data, so a failing test is
 *   reproducible rather than "worked on mine".
 * - **Idempotent.** Everything upserts on its known id, so running it twice is
 *   a no-op rather than a duplicate-key error or a second copy of the org.
 *
 * The shape matters too. A closed cycle with full history sitting beside an
 * active one is exactly what the prototype could not represent: its period
 * switch ran `updateMany({}, { $set: { quarter } })` and overwrote every
 * historical sheet (PLAN.md F-03).
 */

const connectionString = process.env['DATABASE_URL'];

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ORG = 'org-acme';
const FY25 = 'cyc-fy25';
const FY26 = 'cyc-fy26';

const TEAMS = [
  { id: 'team-eng', name: 'Engineering' },
  { id: 'team-sales', name: 'Sales' },
  { id: 'team-ops', name: 'Operations' },
  { id: 'team-people', name: 'People' },
] as const;

type Seeded = {
  id: string;
  name: string;
  email: string;
  roles: ('EMPLOYEE' | 'MANAGER' | 'HR_ADMIN' | 'ORG_ADMIN')[];
  managerId: string | null;
  teamId: string | null;
};

/**
 * 25 people in a three-level chain: one CEO, four team leads reporting to her,
 * twenty individual contributors reporting to a lead.
 */
function buildPeople(): Seeded[] {
  const people: Seeded[] = [
    {
      id: 'usr-000',
      name: 'Ada Okonkwo',
      email: 'ada.okonkwo@acme.test',
      roles: ['ORG_ADMIN', 'MANAGER', 'EMPLOYEE'],
      managerId: null,
      teamId: null,
    },
  ];

  const leadNames = ['Bruno Salvatore', 'Chen Wei', 'Devi Raman', 'Erik Lindqvist'];
  leadNames.forEach((name, i) => {
    const team = TEAMS[i];
    people.push({
      id: `usr-lead-${i}`,
      name,
      email: `${name.split(' ')[0]?.toLowerCase() ?? 'lead'}.${i}@acme.test`,
      // The People lead is also the HR admin — one person, two hats, which is
      // why roles is an array rather than a single column.
      roles: team?.id === 'team-people' ? ['MANAGER', 'HR_ADMIN', 'EMPLOYEE'] : ['MANAGER', 'EMPLOYEE'],
      managerId: 'usr-000',
      teamId: team?.id ?? null,
    });
  });

  const icNames = [
    'Farah Nasser', 'Gustavo Pinto', 'Hana Ito', 'Ivan Petrov', 'Jonah Blake',
    'Kavya Nair', 'Liam Doyle', 'Mira Haddad', 'Noor Rahman', 'Omar Farouk',
    'Priya Sethi', 'Quentin Roy', 'Rosa Delgado', 'Sami Toure', 'Tara Bishop',
    'Umar Siddiqui', 'Vera Novak', 'Wei Lin', 'Xolani Dube', 'Yara Costa',
  ];

  icNames.forEach((name, i) => {
    const leadIndex = i % 4;
    people.push({
      id: `usr-ic-${String(i).padStart(2, '0')}`,
      name,
      email: `${name.split(' ')[0]?.toLowerCase() ?? 'ic'}.${i}@acme.test`,
      roles: ['EMPLOYEE'],
      managerId: `usr-lead-${leadIndex}`,
      teamId: TEAMS[leadIndex]?.id ?? null,
    });
  });

  return people;
}

/** Four goals summing to exactly 100, varied across UoM and direction. */
function goalsFor(sheetId: string, seedIndex: number) {
  const completed = seedIndex % 3 === 0;

  return [
    {
      id: `${sheetId}-g0`,
      sheetId,
      thrustArea: 'BUSINESS_GROWTH' as const,
      title: 'Grow qualified pipeline',
      uom: 'NUMERIC' as const,
      direction: 'HIGHER_IS_BETTER' as const,
      target: '120',
      weightage: 40,
      actualAchievement: completed ? '130' : '75',
      status: completed ? ('COMPLETED' as const) : ('ON_TRACK' as const),
    },
    {
      id: `${sheetId}-g1`,
      sheetId,
      thrustArea: 'OPERATIONAL_EXCELLENCE' as const,
      // Named to look like the prototype's substring trap: this title contains
      // "cost", which used to flip scoring direction by accident (F-06).
      // Direction is now explicit, so the name is just a name.
      title: 'Reduce cost per transaction',
      uom: 'NUMERIC' as const,
      direction: 'LOWER_IS_BETTER' as const,
      target: '4.50',
      weightage: 25,
      actualAchievement: completed ? '4.10' : '5.20',
      status: completed ? ('COMPLETED' as const) : ('ON_TRACK' as const),
    },
    {
      id: `${sheetId}-g2`,
      sheetId,
      thrustArea: 'COMPLIANCE_AND_RISK' as const,
      title: 'Critical security findings outstanding',
      uom: 'ZERO_BASED' as const,
      direction: 'LOWER_IS_BETTER' as const,
      target: '0',
      weightage: 20,
      actualAchievement: '0',
      status: 'COMPLETED' as const,
    },
    {
      id: `${sheetId}-g3`,
      sheetId,
      thrustArea: 'TECHNOLOGY_AND_INNOVATION' as const,
      title: 'Ship platform migration',
      uom: 'TIMELINE' as const,
      direction: 'HIGHER_IS_BETTER' as const,
      target: '2026-03-31',
      weightage: 15,
      actualAchievement: null,
      status: completed ? ('COMPLETED' as const) : ('NOT_STARTED' as const),
    },
  ];
}

async function main(): Promise<void> {
  const people = buildPeople();

  await prisma.organization.upsert({
    where: { id: ORG },
    create: { id: ORG, name: 'Acme Corporation', slug: 'acme', fiscalYearStart: 4 },
    update: { name: 'Acme Corporation' },
  });

  // Users before teams, because Team.leadId points at a user; then teams are
  // attached back to users in a second pass.
  for (const p of people) {
    await prisma.user.upsert({
      where: { id: p.id },
      create: {
        id: p.id,
        orgId: ORG,
        email: p.email,
        name: p.name,
        roles: p.roles,
        status: 'ACTIVE',
        managerId: p.managerId,
      },
      update: { name: p.name, roles: p.roles, managerId: p.managerId },
    });
  }

  for (const [i, team] of TEAMS.entries()) {
    await prisma.team.upsert({
      where: { id: team.id },
      create: { id: team.id, orgId: ORG, name: team.name, leadId: `usr-lead-${i}` },
      update: { name: team.name, leadId: `usr-lead-${i}` },
    });
  }

  for (const p of people) {
    if (p.teamId) {
      await prisma.user.update({ where: { id: p.id }, data: { teamId: p.teamId } });
    }
  }

  // ── Two cycles. The closed one keeps its history intact. ──────────────────
  await prisma.reviewCycle.upsert({
    where: { id: FY25 },
    create: {
      id: FY25,
      orgId: ORG,
      name: 'FY2025',
      fiscalYear: 2025,
      status: 'CLOSED',
      ratingScale: { min: 1, max: 5, labels: ['Below', 'Partial', 'Meets', 'Exceeds', 'Outstanding'] },
    },
    update: { status: 'CLOSED' },
  });

  await prisma.reviewCycle.upsert({
    where: { id: FY26 },
    create: {
      id: FY26,
      orgId: ORG,
      name: 'FY2026',
      fiscalYear: 2026,
      status: 'ACTIVE',
      ratingScale: { min: 1, max: 5, labels: ['Below', 'Partial', 'Meets', 'Exceeds', 'Outstanding'] },
    },
    update: { status: 'ACTIVE' },
  });

  const phases = [
    { key: 'GOAL_SETTING' as const, label: 'Goal Setting', startsAt: '2026-04-01', endsAt: '2026-04-30' },
    { key: 'CHECK_IN' as const, label: 'Mid-year Check-in', startsAt: '2026-09-01', endsAt: '2026-09-30' },
    { key: 'APPRAISAL' as const, label: 'Appraisal', startsAt: '2027-03-01', endsAt: '2027-03-20' },
    { key: 'CALIBRATION' as const, label: 'Calibration', startsAt: '2027-03-21', endsAt: '2027-03-28' },
    { key: 'RESULTS' as const, label: 'Results', startsAt: '2027-03-29', endsAt: '2027-04-05' },
  ];

  for (const cycleId of [FY25, FY26]) {
    const yearShift = cycleId === FY25 ? -1 : 0;
    for (const phase of phases) {
      const id = `${cycleId}-${phase.key}`;
      const shift = (iso: string): Date => {
        const d = new Date(iso);
        d.setUTCFullYear(d.getUTCFullYear() + yearShift);
        return d;
      };
      await prisma.cyclePhase.upsert({
        where: { id },
        create: {
          id,
          cycleId,
          key: phase.key,
          label: phase.label,
          startsAt: shift(phase.startsAt),
          endsAt: shift(phase.endsAt),
        },
        update: {},
      });
    }
  }

  // ── FY25: everyone approved, appraised, released. ─────────────────────────
  for (const [i, p] of people.entries()) {
    const sheetId = `sheet-fy25-${p.id}`;

    await prisma.goalSheet.upsert({
      where: { id: sheetId },
      create: {
        id: sheetId,
        orgId: ORG,
        userId: p.id,
        cycleId: FY25,
        status: 'APPROVED',
        submittedAt: new Date('2025-04-20'),
        approvedAt: new Date('2025-04-25'),
        approverId: p.managerId ?? p.id,
        lockedAt: new Date('2025-04-25'),
        revision: 2,
      },
      update: {},
    });

    for (const goal of goalsFor(sheetId, i)) {
      await prisma.goal.upsert({ where: { id: goal.id }, create: goal, update: {} });
    }

    await prisma.appraisal.upsert({
      where: { sheetId },
      create: {
        id: `apr-${sheetId}`,
        sheetId,
        selfRating: 3 + (i % 2),
        selfNarrative: 'Delivered against the agreed targets.',
        selfSubmittedAt: new Date('2026-03-05'),
        managerId: p.managerId ?? p.id,
        managerRating: 3 + (i % 2),
        managerNarrative: 'Consistent delivery through the year.',
        managerSubmittedAt: new Date('2026-03-12'),
        finalRating: 3 + (i % 2),
        releasedAt: new Date('2026-03-30'),
      },
      update: {},
    });

    await prisma.sheetRevision.upsert({
      where: { sheetId_revision: { sheetId, revision: 1 } },
      create: {
        id: `rev-${sheetId}-1`,
        sheetId,
        revision: 1,
        reason: 'SUBMIT',
        actorId: p.id,
        snapshot: { goals: goalsFor(sheetId, i).map((g) => ({ ...g, weightage: String(g.weightage) })) },
      },
      update: {},
    });
  }

  // ── FY26: mid-goal-setting, sheets in every status. ───────────────────────
  const statuses = ['DRAFT', 'PENDING', 'RETURNED', 'APPROVED'] as const;

  for (const [i, p] of people.entries()) {
    const sheetId = `sheet-fy26-${p.id}`;
    const status = statuses[i % statuses.length] ?? 'DRAFT';
    const approved = status === 'APPROVED';

    await prisma.goalSheet.upsert({
      where: { id: sheetId },
      create: {
        id: sheetId,
        orgId: ORG,
        userId: p.id,
        cycleId: FY26,
        status,
        submittedAt: status === 'DRAFT' ? null : new Date('2026-04-18'),
        approvedAt: approved ? new Date('2026-04-22') : null,
        approverId: approved ? (p.managerId ?? p.id) : null,
        lockedAt: approved ? new Date('2026-04-22') : null,
        revision: status === 'DRAFT' ? 0 : 1,
      },
      update: {},
    });

    for (const goal of goalsFor(sheetId, i)) {
      await prisma.goal.upsert({ where: { id: goal.id }, create: goal, update: {} });
    }
  }

  // ── One cascaded departmental KPI, owned by a real user. ──────────────────
  await prisma.sharedGoal.upsert({
    where: { id: 'shared-security' },
    create: {
      id: 'shared-security',
      orgId: ORG,
      cycleId: FY26,
      // A user reference, not a display name. The prototype matched owners by
      // lowercased name (F-05).
      ownerUserId: 'usr-lead-0',
      createdById: 'usr-000',
      title: 'Zero critical security findings',
      thrustArea: 'COMPLIANCE_AND_RISK',
      uom: 'ZERO_BASED',
      direction: 'LOWER_IS_BETTER',
      target: '0',
      defaultWeightage: 10,
      audience: { kind: 'team', teamId: 'team-eng' },
    },
    update: {},
  });

  // ── Governance: a few audit events and two live escalations. ──────────────
  await prisma.auditEvent.upsert({
    where: { id: 'audit-0001' },
    create: {
      id: 'audit-0001',
      orgId: ORG,
      actorId: 'usr-000',
      action: 'cycle.activate',
      entityType: 'ReviewCycle',
      entityId: FY26,
      before: { status: 'DRAFT' },
      after: { status: 'ACTIVE' },
    },
    update: {},
  });

  await prisma.auditEvent.upsert({
    where: { id: 'audit-0002' },
    create: {
      id: 'audit-0002',
      orgId: ORG,
      actorId: 'usr-lead-0',
      action: 'sharedgoal.cascade',
      entityType: 'SharedGoal',
      entityId: 'shared-security',
      after: { recipients: 5, skipped: 0 },
    },
    update: {},
  });

  for (const [i, subject] of ['usr-ic-01', 'usr-ic-05'].entries()) {
    await prisma.escalation.upsert({
      where: {
        cycleId_subjectUserId_rule: {
          cycleId: FY26,
          subjectUserId: subject,
          rule: 'GOALS_NOT_SUBMITTED',
        },
      },
      create: {
        id: `esc-000${i + 1}`,
        orgId: ORG,
        cycleId: FY26,
        subjectUserId: subject,
        rule: 'GOALS_NOT_SUBMITTED',
        tier: i === 0 ? 'EMPLOYEE' : 'MANAGER',
        // A real deadline from the phase, not a synthetic count.
        dueAt: new Date('2026-04-30T23:59:59Z'),
        notifiedAt: i === 0 ? [new Date('2026-05-01')] : [new Date('2026-05-01'), new Date('2026-05-08')],
      },
      update: {},
    });
  }

  const counts = {
    users: await prisma.user.count({ where: { orgId: ORG } }),
    teams: await prisma.team.count({ where: { orgId: ORG } }),
    cycles: await prisma.reviewCycle.count({ where: { orgId: ORG } }),
    sheets: await prisma.goalSheet.count({ where: { orgId: ORG } }),
    goals: await prisma.goal.count(),
    appraisals: await prisma.appraisal.count(),
    escalations: await prisma.escalation.count({ where: { orgId: ORG } }),
  };

  console.info('Seeded Acme Corporation:', counts);
}

main()
  .then(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    return prisma.$disconnect().finally(() => {
      process.exitCode = 1;
    });
  });
