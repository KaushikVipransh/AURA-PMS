-- CreateEnum
CREATE TYPE "RevisionReason" AS ENUM ('SUBMIT', 'APPROVE', 'ADJUST');

-- CreateTable
CREATE TABLE "appraisals" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "selfRating" INTEGER,
    "selfNarrative" TEXT,
    "selfSubmittedAt" TIMESTAMP(3),
    "managerId" TEXT,
    "managerRating" INTEGER,
    "managerNarrative" TEXT,
    "managerSubmittedAt" TIMESTAMP(3),
    "finalRating" INTEGER,
    "calibratedById" TEXT,
    "calibrationReason" TEXT,
    "releasedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementComment" TEXT,
    "disputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appraisals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_ratings" (
    "id" TEXT NOT NULL,
    "appraisalId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "rating" INTEGER,
    "narrative" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_revisions" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" "RevisionReason" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheet_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appraisals_sheetId_key" ON "appraisals"("sheetId");

-- CreateIndex
CREATE INDEX "appraisals_releasedAt_idx" ON "appraisals"("releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "goal_ratings_appraisalId_goalId_key" ON "goal_ratings"("appraisalId", "goalId");

-- CreateIndex
CREATE INDEX "sheet_revisions_sheetId_createdAt_idx" ON "sheet_revisions"("sheetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_revisions_sheetId_revision_key" ON "sheet_revisions"("sheetId", "revision");

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "goal_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appraisals" ADD CONSTRAINT "appraisals_calibratedById_fkey" FOREIGN KEY ("calibratedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_ratings" ADD CONSTRAINT "goal_ratings_appraisalId_fkey" FOREIGN KEY ("appraisalId") REFERENCES "appraisals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_ratings" ADD CONSTRAINT "goal_ratings_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_revisions" ADD CONSTRAINT "sheet_revisions_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "goal_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_revisions" ADD CONSTRAINT "sheet_revisions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
