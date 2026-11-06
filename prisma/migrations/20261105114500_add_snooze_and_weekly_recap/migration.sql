ALTER TABLE "WorkItem" ADD COLUMN "snoozedUntil" TIMESTAMP(3);
ALTER TABLE "WorkItem" ADD COLUMN "resolvedAt" TIMESTAMP(3);
CREATE INDEX "WorkItem_userId_snoozedUntil_idx" ON "WorkItem"("userId", "snoozedUntil");

ALTER TABLE "users" ADD COLUMN "weeklyRecapEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "lastWeeklyRecapAt" TIMESTAMP(3);
