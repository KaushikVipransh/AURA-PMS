-- CreateTable
CREATE TABLE "cycle_metrics" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "capturedOn" TIMESTAMP(3) NOT NULL,
    "completedFullCycle" INTEGER NOT NULL DEFAULT 0,
    "totalEmployees" INTEGER NOT NULL DEFAULT 0,
    "sheetsApproved" INTEGER NOT NULL DEFAULT 0,
    "sheetsSubmitted" INTEGER NOT NULL DEFAULT 0,
    "checkInsRecorded" INTEGER NOT NULL DEFAULT 0,
    "sheetsWithComments" INTEGER NOT NULL DEFAULT 0,
    "selfAppraisalsOnTime" INTEGER NOT NULL DEFAULT 0,
    "sheetsReturned" INTEGER NOT NULL DEFAULT 0,
    "ratingsDisputed" INTEGER NOT NULL DEFAULT 0,
    "divergentRatings" INTEGER NOT NULL DEFAULT 0,
    "ratingsTotal" INTEGER NOT NULL DEFAULT 0,
    "openEscalations" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cycle_metrics_orgId_capturedOn_idx" ON "cycle_metrics"("orgId", "capturedOn");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_metrics_cycleId_capturedOn_key" ON "cycle_metrics"("cycleId", "capturedOn");

-- AddForeignKey
ALTER TABLE "cycle_metrics" ADD CONSTRAINT "cycle_metrics_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

