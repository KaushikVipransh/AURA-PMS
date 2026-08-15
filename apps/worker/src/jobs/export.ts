/**
 * Background CSV export (PRD US-1002) — W5-05.
 *
 * A background job rather than a request handler, because an export of a large
 * cycle is measured in seconds and a request that takes seconds is a request
 * that times out behind a proxy. The caller gets a job id; the job produces a
 * signed URL.
 *
 * Serialisation is W2-08's `serializeCsv`, which is the only place the RFC 4180
 * quoting and the `= + - @` formula neutralisation live. Rewriting either here
 * would be a second opinion on a question with one right answer — and the
 * dangerous half of it is silent: a cell reading `=cmd|'/c calc'!A1` opens a
 * spreadsheet that runs it.
 */

import { prisma } from '@aura/db';
import { buildAuditEvent, serializeCsv, type AuditActor, type CsvColumn } from '@aura/core';

import { storageFromEnv, type StorageAdapter } from '../storage.js';

/** How long an export link stays live. */
export const EXPORT_URL_TTL_SECONDS = 60 * 60 * 24;

export type ExportJob = {
  readonly orgId: string;
  readonly actorId: string;
  readonly cycleId: string;
  /** The columns to include. Part of the request, never implied. */
  readonly columns?: readonly string[];
};

type SheetRow = {
  employeeName: string;
  employeeEmail: string;
  managerName: string;
  sheetStatus: string;
  goalTitle: string;
  thrustArea: string;
  uom: string;
  direction: string;
  target: string;
  actual: string;
  weightage: string;
  goalStatus: string;
  managerRating: string;
  finalRating: string;
};

/**
 * Every column an export can contain, by name.
 *
 * A whitelist, so a request naming a column is choosing from this list rather
 * than reaching into the row. Adding a field to a model does not silently
 * widen what leaves the system.
 */
export const EXPORT_COLUMNS: Readonly<Record<string, CsvColumn<SheetRow>>> = {
  employeeName: { header: 'Employee', value: (row) => row.employeeName },
  employeeEmail: { header: 'Email', value: (row) => row.employeeEmail },
  managerName: { header: 'Manager', value: (row) => row.managerName },
  sheetStatus: { header: 'Sheet status', value: (row) => row.sheetStatus },
  goalTitle: { header: 'Goal', value: (row) => row.goalTitle },
  thrustArea: { header: 'Thrust area', value: (row) => row.thrustArea },
  uom: { header: 'UoM', value: (row) => row.uom },
  direction: { header: 'Direction', value: (row) => row.direction },
  target: { header: 'Target', value: (row) => row.target },
  actual: { header: 'Actual', value: (row) => row.actual },
  weightage: { header: 'Weightage', value: (row) => row.weightage },
  goalStatus: { header: 'Goal status', value: (row) => row.goalStatus },
  managerRating: { header: 'Manager rating', value: (row) => row.managerRating },
  finalRating: { header: 'Final rating', value: (row) => row.finalRating },
};

export const DEFAULT_EXPORT_COLUMNS = Object.keys(EXPORT_COLUMNS);

export type ExportResult = {
  readonly key: string;
  readonly url: string;
  readonly rows: number;
};

/**
 * Generate a cycle export, store it, and record that it happened.
 *
 * **The export is audited.** Someone taking every rating in the organization
 * out of the system is exactly the event a compliance trail exists to record,
 * and it is the one the prototype would have missed entirely — it logged one
 * action out of a dozen (F-09).
 */
export async function runExport(
  job: ExportJob,
  storage: StorageAdapter = storageFromEnv(),
): Promise<ExportResult> {
  const names = (job.columns ?? DEFAULT_EXPORT_COLUMNS).filter(
    (name) => name in EXPORT_COLUMNS,
  );

  if (names.length === 0) {
    throw new Error('An export needs at least one known column.');
  }

  const sheets = await prisma.goalSheet.findMany({
    where: { orgId: job.orgId, cycleId: job.cycleId },
    orderBy: { id: 'asc' },
    select: {
      status: true,
      user: {
        select: { name: true, email: true, manager: { select: { name: true } } },
      },
      goals: {
        orderBy: { title: 'asc' },
        select: {
          title: true,
          thrustArea: true,
          uom: true,
          direction: true,
          target: true,
          actualAchievement: true,
          weightage: true,
          status: true,
        },
      },
      appraisal: { select: { managerRating: true, finalRating: true } },
    },
  });

  /* One row per goal rather than per sheet. A spreadsheet with a nested list
     in a cell is not analysable, which is the entire reason someone exports. */
  const rows: SheetRow[] = sheets.flatMap((sheet) =>
    sheet.goals.map((goal) => ({
      employeeName: sheet.user.name,
      employeeEmail: sheet.user.email,
      managerName: sheet.user.manager?.name ?? '',
      sheetStatus: sheet.status,
      goalTitle: goal.title,
      thrustArea: goal.thrustArea,
      uom: goal.uom,
      direction: goal.direction,
      target: goal.target,
      actual: goal.actualAchievement ?? '',
      weightage: goal.weightage.toString(),
      goalStatus: goal.status,
      managerRating: sheet.appraisal?.managerRating?.toString() ?? '',
      finalRating: sheet.appraisal?.finalRating?.toString() ?? '',
    })),
  );

  const body = serializeCsv(
    names.map((name) => EXPORT_COLUMNS[name] as CsvColumn<SheetRow>),
    rows,
    // Excel is the likely reader, and without the BOM every non-ASCII name in
    // the export arrives mangled.
    { bom: true },
  );

  const key = `exports/${job.orgId}/${job.cycleId}/${String(Date.now())}.csv`;

  await storage.put({ key, body, contentType: 'text/csv; charset=utf-8' });

  const url = await storage.signedUrl(key, EXPORT_URL_TTL_SECONDS);

  await recordExport(job, key, rows.length);

  return { key, url, rows: rows.length };
}

/**
 * Write the audit row for an export.
 *
 * Not wrapped in `withAudit`: that helper belongs to the API's service layer
 * and puts a mutation and its audit row in one transaction. There is no
 * mutation here — the export reads — so what is recorded is the *act of
 * exporting*, built through the same `buildAuditEvent` so the row is shaped
 * identically to every other one in the trail.
 */
async function recordExport(job: ExportJob, key: string, rows: number): Promise<void> {
  const actor: AuditActor = { userId: job.actorId, orgId: job.orgId, ip: null, userAgent: null };

  const event = buildAuditEvent(
    actor,
    'cycle.export',
    { entityType: 'ReviewCycle', entityId: job.cycleId },
    {},
    { key, rows, columns: job.columns ?? DEFAULT_EXPORT_COLUMNS },
  );

  if (event === null) {
    return;
  }

  await prisma.auditEvent.create({
    data: {
      orgId: event.orgId,
      actorId: event.actorId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: event.before as Record<string, string>,
      after: event.after as Record<string, string>,
      ip: event.ip,
      userAgent: event.userAgent,
    },
  });
}
