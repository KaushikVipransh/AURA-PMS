import { afterAll, describe, expect, it } from 'vitest';

import { closeTestDb, withTestDb, type TestDb } from '../testing/index.js';

let seq = 0;
const uniq = (prefix: string): string => `${prefix}-${Date.now()}-${++seq}`;

async function makeOrg(tx: TestDb, label = 'acme') {
  return tx.organization.create({
    data: { name: `${label} Inc`, slug: uniq(label) },
  });
}

afterAll(async () => {
  await closeTestDb();
});

describe('Organization [W1-02]', () => {
  it('rejects a duplicate slug at the database level', async () => {
    await withTestDb(async (tx) => {
      const slug = uniq('dup');
      await tx.organization.create({ data: { name: 'First', slug } });

      await expect(
        tx.organization.create({ data: { name: 'Second', slug } }),
      ).rejects.toThrow();
    });
  });

  it('defaults the fiscal year to April', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);
      expect(org.fiscalYearStart).toBe(4);
    });
  });
});

describe('User [W1-03]', () => {
  it('resolves the manager self-relation in both directions', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);

      const boss = await tx.user.create({
        data: { orgId: org.id, email: uniq('boss') + '@x.com', name: 'Boss' },
      });
      await tx.user.create({
        data: {
          orgId: org.id,
          email: uniq('report') + '@x.com',
          name: 'Report',
          managerId: boss.id,
        },
      });

      const withReports = await tx.user.findUniqueOrThrow({
        where: { id: boss.id },
        include: { reports: true },
      });

      expect(withReports.reports).toHaveLength(1);
      expect(withReports.reports[0]?.name).toBe('Report');
    });
  });

  it('rejects a manager from a different organization', async () => {
    await withTestDb(async (tx) => {
      const orgA = await makeOrg(tx, 'alpha');
      const orgB = await makeOrg(tx, 'beta');

      const managerInA = await tx.user.create({
        data: { orgId: orgA.id, email: uniq('mgr') + '@a.com', name: 'Manager A' },
      });

      // The composite FK is (managerId, orgId) -> (id, orgId), so Postgres
      // looks for a user with this id *in org B* and finds none. Tenancy is
      // enforced by the database, not by remembering to check.
      await expect(
        tx.user.create({
          data: {
            orgId: orgB.id,
            email: uniq('victim') + '@b.com',
            name: 'Cross-tenant',
            managerId: managerInA.id,
          },
        }),
      ).rejects.toThrow();
    });
  });

  it('allows a user with no manager, so the chain has a top', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);
      const ceo = await tx.user.create({
        data: { orgId: org.id, email: uniq('ceo') + '@x.com', name: 'CEO' },
      });

      expect(ceo.managerId).toBeNull();
      expect(ceo.roles).toStrictEqual(['EMPLOYEE']);
      expect(ceo.status).toBe('INVITED');
    });
  });

  /**
   * Reversed in W3-01, deliberately.
   *
   * W1-03 keyed this `@@unique([orgId, email])`, on the reasoning that the same
   * address in two tenants is two different people. That reasoning is sound in
   * the abstract and wrong for this product. Better Auth resolves a login by
   * email alone, and there is no second field on a login form to disambiguate
   * with — so a duplicate address makes "who is signing in" genuinely
   * unanswerable rather than merely awkward.
   *
   * One person belongs to one organization (PRD E1), so the wider constraint
   * costs nothing real. The test is rewritten rather than deleted: the case it
   * covers still matters, the expected answer changed.
   */
  it('makes email globally unique, so a login resolves to exactly one person', async () => {
    await withTestDb(async (tx) => {
      const orgA = await makeOrg(tx, 'alpha');
      const orgB = await makeOrg(tx, 'beta');
      const email = uniq('shared') + '@x.com';

      await tx.user.create({ data: { orgId: orgA.id, email, name: 'A' } });

      // Rejected across organizations...
      await expect(
        tx.user.create({ data: { orgId: orgB.id, email, name: 'B' } }),
      ).rejects.toThrow();

      // ...and within one.
      await expect(
        tx.user.create({ data: { orgId: orgA.id, email, name: 'Dup' } }),
      ).rejects.toThrow();
    });
  });

  it('still isolates the reporting line to one organization', async () => {
    // Widening the email constraint did not weaken tenancy: the composite
    // foreign key on (managerId, orgId) is what enforces that, and it is
    // untouched.
    await withTestDb(async (tx) => {
      const orgA = await makeOrg(tx, 'alpha');
      const orgB = await makeOrg(tx, 'beta');

      const bossA = await tx.user.create({
        data: { orgId: orgA.id, email: uniq('boss') + '@x.com', name: 'Boss A' },
      });

      await expect(
        tx.user.create({
          data: {
            orgId: orgB.id,
            email: uniq('report') + '@x.com',
            name: 'Report B',
            managerId: bossA.id,
          },
        }),
      ).rejects.toThrow();
    });
  });
});

describe('Team [W1-04]', () => {
  it('supports a two-level hierarchy', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);

      const parent = await tx.team.create({
        data: { orgId: org.id, name: uniq('Engineering') },
      });
      const child = await tx.team.create({
        data: { orgId: org.id, name: uniq('Platform'), parentTeamId: parent.id },
      });

      const loaded = await tx.team.findUniqueOrThrow({
        where: { id: parent.id },
        include: { childTeams: true },
      });

      expect(loaded.childTeams.map((t) => t.id)).toStrictEqual([child.id]);
    });
  });

  it('links a lead and members', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);
      const lead = await tx.user.create({
        data: { orgId: org.id, email: uniq('lead') + '@x.com', name: 'Lead' },
      });
      const team = await tx.team.create({
        data: { orgId: org.id, name: uniq('Design'), leadId: lead.id },
      });
      await tx.user.update({ where: { id: lead.id }, data: { teamId: team.id } });

      const loaded = await tx.team.findUniqueOrThrow({
        where: { id: team.id },
        include: { lead: true, members: true },
      });

      expect(loaded.lead?.name).toBe('Lead');
      expect(loaded.members).toHaveLength(1);
    });
  });

  it('rejects a duplicate team name within one organization', async () => {
    await withTestDb(async (tx) => {
      const org = await makeOrg(tx);
      const name = uniq('Ops');

      await tx.team.create({ data: { orgId: org.id, name } });

      await expect(tx.team.create({ data: { orgId: org.id, name } })).rejects.toThrow();
    });
  });
});
