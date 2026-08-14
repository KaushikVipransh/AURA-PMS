-- CreateTable
CREATE TABLE "sheet_comments" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "goalId" TEXT,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "editableUntil" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheet_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sheet_comments_orgId_sheetId_createdAt_idx" ON "sheet_comments"("orgId", "sheetId", "createdAt");

-- CreateIndex
CREATE INDEX "sheet_comments_sheetId_goalId_idx" ON "sheet_comments"("sheetId", "goalId");

-- AddForeignKey
ALTER TABLE "sheet_comments" ADD CONSTRAINT "sheet_comments_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "goal_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_comments" ADD CONSTRAINT "sheet_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_comments" ADD CONSTRAINT "sheet_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "sheet_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

