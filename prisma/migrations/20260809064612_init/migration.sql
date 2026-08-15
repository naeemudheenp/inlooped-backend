-- Trigram matching powers the near-duplicate ingest gate and typo-tolerant
-- retrieval fallback ("chekout" -> "Checkout timeouts").
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('TASK', 'REFERENCE', 'WAITING', 'REMEMBER');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" TEXT NOT NULL,
    "name" VARCHAR(100),
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "slackAccessToken" TEXT,
    "slackUserId" TEXT,
    "slackTeamId" TEXT,
    "slackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "slackTimezone" TEXT DEFAULT 'UTC',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "sourceText" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceApp" TEXT NOT NULL DEFAULT 'slack',
    "sourceUrl" TEXT,
    "sourceChannel" TEXT,
    "personName" TEXT,
    "topic" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "surfaceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastSurfacedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- searchVector is added below as a GENERATED column, not here: Postgres then
-- maintains it on every insert and update, so there is no trigger to write and
-- no way for the index to drift out of sync with the row.

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentQuery" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "questionHash" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "itemIds" JSONB NOT NULL DEFAULT '[]',
    "route" TEXT NOT NULL DEFAULT 'llm',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "WorkItem_userId_status_surfaceScore_idx" ON "WorkItem"("userId", "status", "surfaceScore");

-- CreateIndex
CREATE INDEX "WorkItem_userId_personName_idx" ON "WorkItem"("userId", "personName");

-- CreateIndex
CREATE INDEX "WorkItem_userId_topic_idx" ON "WorkItem"("userId", "topic");

-- CreateIndex
CREATE INDEX "WorkItem_userId_occurredAt_idx" ON "WorkItem"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_userId_sourceHash_key" ON "WorkItem"("userId", "sourceHash");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_day_idx" ON "JournalEntry"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_userId_day_key" ON "JournalEntry"("userId", "day");

-- CreateIndex
CREATE INDEX "AgentQuery_userId_questionHash_createdAt_idx" ON "AgentQuery"("userId", "questionHash", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentQuery" ADD CONSTRAINT "AgentQuery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Full-text search: weighted, generated, self-maintaining.
--   A = title + topic   (what the item is)
--   B = personName      (who it involves)
--   C = detail          (agent-written summary)
--   D = sourceText      (raw forwarded text — matched, but ranked lowest)
-- ---------------------------------------------------------------------------
ALTER TABLE "WorkItem" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("topic", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("personName", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("detail", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("sourceText", '')), 'D')
  ) STORED;

CREATE INDEX "WorkItem_searchVector_idx" ON "WorkItem" USING GIN ("searchVector");

-- Trigram indexes: typo-tolerant retrieval fallback + the near-duplicate gate.
CREATE INDEX "WorkItem_title_trgm_idx" ON "WorkItem" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "WorkItem_personName_trgm_idx" ON "WorkItem" USING GIN ("personName" gin_trgm_ops);
CREATE INDEX "WorkItem_sourceText_trgm_idx" ON "WorkItem" USING GIN ("sourceText" gin_trgm_ops);
