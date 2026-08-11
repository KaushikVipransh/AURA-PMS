-- CreateEnum
CREATE TYPE "SheetStatus" AS ENUM ('DRAFT', 'PENDING', 'RETURNED', 'APPROVED');

-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "thrustArea" "ThrustArea" NOT NULL,
    "title" TEXT NOT NULL,
    "uom" "Uom" NOT NULL,
    "direction" "GoalDirection" NOT NULL,
    "target" TEXT NOT NULL,
    "weightage" DECIMAL(5,2) NOT NULL,
    "actualAchievement" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "sharedGoalId" TEXT,
    "isPrimaryOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_sheets" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "status" "SheetStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approverId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_goals" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thrustArea" "ThrustArea" NOT NULL,
    "uom" "Uom" NOT NULL,
    "direction" "GoalDirection" NOT NULL,
    "target" TEXT NOT NULL,
    "defaultWeightage" DECIMAL(5,2) NOT NULL,
    "audience" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goals_sheetId_idx" ON "goals"("sheetId");

-- CreateIndex
CREATE INDEX "goals_sharedGoalId_idx" ON "goals"("sharedGoalId");

-- CreateIndex
CREATE UNIQUE INDEX "goals_sheetId_sharedGoalId_key" ON "goals"("sheetId", "sharedGoalId");

-- CreateIndex
CREATE INDEX "goal_sheets_orgId_cycleId_status_idx" ON "goal_sheets"("orgId", "cycleId", "status");

-- CreateIndex
CREATE INDEX "goal_sheets_orgId_status_idx" ON "goal_sheets"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "goal_sheets_userId_cycleId_key" ON "goal_sheets"("userId", "cycleId");

-- CreateIndex
CREATE INDEX "shared_goals_orgId_cycleId_idx" ON "shared_goals"("orgId", "cycleId");

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "goal_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_sharedGoalId_fkey" FOREIGN KEY ("sharedGoalId") REFERENCES "shared_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_sheets" ADD CONSTRAINT "goal_sheets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_sheets" ADD CONSTRAINT "goal_sheets_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_sheets" ADD CONSTRAINT "goal_sheets_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_goals" ADD CONSTRAINT "shared_goals_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_goals" ADD CONSTRAINT "shared_goals_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_goals" ADD CONSTRAINT "shared_goals_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
