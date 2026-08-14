-- AlterTable
ALTER TABLE "goal_ratings" ADD COLUMN     "selfNarrative" TEXT;

-- AlterTable
ALTER TABLE "review_cycles" ADD COLUMN     "selfAppraisalDueAt" TIMESTAMP(3);

