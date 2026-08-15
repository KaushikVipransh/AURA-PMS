/**
 * AuraPMS worker — pg-boss job processor (W5-01).
 *
 * A separate process from the API, so a long-running export cannot degrade
 * request latency and so the two scale independently.
 *
 * **This process is what makes F-08 fixed rather than described.** The
 * prototype's escalation engine ran when an admin clicked a button, which
 * means it ran when somebody remembered — and its notification chain sent
 * nothing at all. Everything here runs on a schedule nobody has to remember.
 */

import { prisma } from '@aura/db';
import type { PgBoss } from 'pg-boss';

import { QUEUES, createBoss, ensureQueues } from './boss.js';
import { log } from './log.js';
import { runWeeklyDigest } from './jobs/digest.js';
import { dispatchNotification, type DispatchJob } from './jobs/dispatch.js';
import { runEscalationSweep } from './jobs/escalations.js';
import { runExport, type ExportJob } from './jobs/export.js';
import { runMetricsSnapshot } from './jobs/metrics.js';

/**
 * When the nightly sweep runs, in UTC.
 *
 * 02:00 rather than midnight: a deadline that falls "on the 3rd" ends at the
 * first instant of the 4th in the organization's zone, and a sweep at exactly
 * midnight UTC would race that boundary for every organization east of it.
 */
export const SWEEP_CRON = '0 2 * * *';

/**
 * The metrics snapshot, half an hour after the sweep.
 *
 * After, not before: the escalation count is one of the numbers it records, so
 * running it first would snapshot yesterday's compliance picture alongside
 * today's everything else.
 */
export const METRICS_CRON = '30 2 * * *';

/** The weekly digest, Monday morning. Nobody reads a round-up on Sunday night. */
export const DIGEST_CRON = '0 8 * * 1';

export type Worker = {
  readonly boss: PgBoss;
  stop(): Promise<void>;
};

/**
 * Start the worker: register handlers, schedule the crons, begin consuming.
 *
 * Handlers are registered *before* `schedule`, so a cron that fires during
 * startup finds a consumer rather than piling up work nothing is reading.
 */
export async function startWorker(): Promise<Worker> {
  const boss = createBoss();

  boss.on('error', (error: unknown) => {
    // pg-boss surfaces connection trouble here. Swallowing it would leave a
    // worker that looks alive and processes nothing, which is the exact
    // failure mode a job system must not have.
    log.error('pg-boss error', error);
  });

  await boss.start();
  await ensureQueues(boss);

  await boss.work(QUEUES.escalationSweep, async () => {
    const result = await runEscalationSweep(new Date(), boss);

    log.info('escalation sweep', result);
  });

  await boss.work<DispatchJob>(QUEUES.notificationDispatch, async ([job]) => {
    if (job === undefined) {
      return;
    }
    await dispatchNotification(job.data);
  });

  await boss.work(QUEUES.metricsSnapshot, async () => {
    const result = await runMetricsSnapshot(new Date());

    log.info('metrics snapshot', result);
  });

  await boss.work(QUEUES.weeklyDigest, async () => {
    const result = await runWeeklyDigest(boss);

    log.info('weekly digest', result);
  });

  await boss.work<ExportJob>(QUEUES.cycleExport, async ([job]) => {
    if (job === undefined) {
      return;
    }
    const result = await runExport(job.data);

    log.info('cycle export', { key: result.key, rows: result.rows });
  });

  await boss.schedule(QUEUES.escalationSweep, SWEEP_CRON);
  await boss.schedule(QUEUES.metricsSnapshot, METRICS_CRON);
  await boss.schedule(QUEUES.weeklyDigest, DIGEST_CRON);

  log.info('started');

  return {
    boss,
    async stop() {
      /*
       * `graceful` lets jobs in flight finish before the process exits. A hard
       * stop mid-job leaves it neither done nor failed until its timeout
       * expires, and on a deploy that means every rolling restart delays the
       * work it interrupted.
       */
      await boss.stop({ graceful: true, close: true });
      await prisma.$disconnect();

      log.info('stopped');
    },
  };
}

/**
 * Wire SIGTERM and SIGINT to a clean stop.
 *
 * SIGTERM is what a container orchestrator sends before it kills a pod, so
 * this is the difference between a deploy that drains and one that drops
 * whatever was running.
 */
export function installSignalHandlers(worker: Worker): () => void {
  let stopping = false;

  const handler = (signal: NodeJS.Signals): void => {
    // Guarded: a second SIGTERM while the first is draining would start a
    // second shutdown and race the first.
    if (stopping) {
      return;
    }
    stopping = true;

    log.info(`${signal} received, draining`);

    void worker
      .stop()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        log.error('shutdown failed', error);
        process.exit(1);
      });
  };

  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);

  return () => {
    process.off('SIGTERM', handler);
    process.off('SIGINT', handler);
  };
}

/** Entry point. Guarded so importing this module in a test starts nothing. */
if (process.env['WORKER_AUTOSTART'] !== 'off') {
  const isMain = process.argv[1] !== undefined && import.meta.url.endsWith('index.js');

  if (isMain) {
    void startWorker().then(installSignalHandlers);
  }
}

export {
  QUEUES,
  createBoss,
  dispatchNotification,
  runEscalationSweep,
  runExport,
  runMetricsSnapshot,
  runWeeklyDigest,
};
