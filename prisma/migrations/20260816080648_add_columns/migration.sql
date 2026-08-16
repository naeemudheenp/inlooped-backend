-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "isPinned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "googleAccessToken" TEXT,
ADD COLUMN     "googleCalendarId" TEXT DEFAULT 'primary',
ADD COLUMN     "googleEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleRefreshToken" TEXT;

-- CreateIndex
CREATE INDEX "WorkItem_userId_isPinned_idx" ON "WorkItem"("userId", "isPinned");
