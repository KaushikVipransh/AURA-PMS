-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "PhaseKey" AS ENUM ('GOAL_SETTING', 'CHECK_IN', 'APPRAISAL', 'CALIBRATION', 'RESULTS');

-- CreateTable
CREATE TABLE "review_cycles" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'DRAFT',
    "ratingScale" JSONB NOT NULL DEFAULT '{}',
    "escalationRules" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycle_phases" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "key" "PhaseKey" NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_phases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_cycles_orgId_status_idx" ON "review_cycles"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "review_cycles_orgId_name_key" ON "review_cycles"("orgId", "name");

-- CreateIndex
CREATE INDEX "cycle_phases_cycleId_startsAt_idx" ON "cycle_phases"("cycleId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_phases_cycleId_key_key" ON "cycle_phases"("cycleId", "key");

-- AddForeignKey
ALTER TABLE "cycle_phases" ADD CONSTRAINT "cycle_phases_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one ACTIVE cycle per organization (PRD US-202).
--
-- A partial unique index, which Prisma's schema language cannot express, so it
-- is written by hand here. Enforcing it in the database rather than in a
-- service means no code path can open a second active cycle by accident —
-- including a migration, a seed script, or a future bulk import.
CREATE UNIQUE INDEX "review_cycles_one_active_per_org"
  ON "review_cycles" ("orgId")
  WHERE "status" = 'ACTIVE';
