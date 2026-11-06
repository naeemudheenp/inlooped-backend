ALTER TABLE "users"
  ADD COLUMN "teamsAccessToken" TEXT,
  ADD COLUMN "teamsRefreshToken" TEXT,
  ADD COLUMN "teamsAccessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "teamsUserId" TEXT,
  ADD COLUMN "teamsUserEmail" TEXT,
  ADD COLUMN "teamsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "teamsTeamId" TEXT,
  ADD COLUMN "teamsChannelId" TEXT,
  ADD COLUMN "teamsNewCaptureNotifications" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "teamsWeeklyRecapEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "teamsTimezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "lastTeamsWeeklyRecapAt" TIMESTAMP(3);
