ALTER TABLE "users"
  ADD COLUMN "teamsTodayDigestEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastTeamsTodayDigestAt" TIMESTAMP(3),
  ADD COLUMN "waitingNudgeSlack" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waitingNudgeTeams" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "waitingNudgeDays" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "lastWaitingNudgeAt" TIMESTAMP(3);

ALTER TABLE "WorkItem" ADD COLUMN "nudgedAt" TIMESTAMP(3);
