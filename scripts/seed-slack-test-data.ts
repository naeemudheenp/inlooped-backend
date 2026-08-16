/**
 * Script to seed realistic Slack test data involving Naeemudheen and Macbeth
 * across multiple channels, direct messages, and threads.
 *
 * Usage:
 *   npx ts-node scripts/seed-slack-test-data.ts
 */
import { PrismaClient, ItemKind, ItemStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { computeSurfaceScore, ScorableItem } from '../src/surface/surface.scoring';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'naeem@inlooped.app';
const DEMO_PASSWORD = 'inlooped';

const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * DAY);

function sourceHash(userId: number, text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
}

interface SlackSeedItem {
  kind: ItemKind;
  status?: ItemStatus;
  title: string;
  detail: string;
  sourceText: string;
  sourceUrl?: string;
  sourceChannel: string;
  personName: 'Macbeth' | 'Naeemudheen' | 'System';
  topic: string;
  importance: number;
  confidence: number;
  messageCount?: number;
  ageDays: number;
  isPinned?: boolean;
}

const SLACK_TEST_ITEMS: SlackSeedItem[] = [
  // --- #engineering channel ---
  {
    kind: 'TASK',
    title: 'Fix latency spikes in vector search pipeline',
    detail: 'Macbeth reported 800ms response times on agent vector queries. You promised to profile the postgres tsvector index and embeddings cache.',
    sourceText: 'Macbeth: Hey @naeemudheen, seeing 800ms+ latency on vector search during peak queries today. Can you take a look at the pgvector index performance?\nNaeemudheen: On it! I will profile the query execution plan and check if the HNSW index is being used properly.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C01ENG/p1755100000000100',
    sourceChannel: 'engineering',
    personName: 'Macbeth',
    topic: 'vector-search',
    importance: 0.9,
    confidence: 0.95,
    messageCount: 5,
    ageDays: 0,
    isPinned: true,
  },
  {
    kind: 'TASK',
    title: 'Implement token refresh retry logic for Slack OAuth',
    detail: 'Naeemudheen asked Macbeth to add exponential backoff when Slack API returns HTTP 429 rate limit errors during token refresh.',
    sourceText: 'Naeemudheen: @macbeth we need to add exponential backoff retry to the Slack OAuth token refresh handler. Slack hit us with rate limits during the bulk sync tests.\nMacbeth: Good call. I will add a retry decorator with jitter to the Slack API client.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C01ENG/p1755000000000200',
    sourceChannel: 'engineering',
    personName: 'Naeemudheen',
    topic: 'slack-oauth',
    importance: 0.8,
    confidence: 0.92,
    messageCount: 3,
    ageDays: 1,
  },
  {
    kind: 'REFERENCE',
    title: 'Architecture doc for Socket Mode integration',
    detail: 'Macbeth shared the technical spec for replacing HTTP webhook endpoints with Slack Socket Mode WebSocket connections.',
    sourceText: 'Macbeth: Shared the technical spec for Slack Socket Mode integration — this eliminates the need for public ngrok tunneling during local development: https://internal-wiki.app/docs/slack-socket-mode-arch',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C01ENG/p1754900000000300',
    sourceChannel: 'engineering',
    personName: 'Macbeth',
    topic: 'architecture',
    importance: 0.7,
    confidence: 0.89,
    messageCount: 2,
    ageDays: 2,
  },

  // --- #product-sync channel ---
  {
    kind: 'WAITING',
    title: 'API documentation signoff from Macbeth',
    detail: 'You sent the OpenAPI v3 specs to Macbeth for review before the v1.2 release.',
    sourceText: 'Naeemudheen: @macbeth uploaded the OpenAPI spec draft for the new Surface API. Let me know if the schema looks good for the desktop app integration.\nMacbeth: Will review this afternoon right after the client sync.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C02PROD/p1754800000000400',
    sourceChannel: 'product-sync',
    personName: 'Macbeth',
    topic: 'api-docs',
    importance: 0.85,
    confidence: 0.91,
    messageCount: 4,
    ageDays: 1,
    isPinned: true,
  },
  {
    kind: 'TASK',
    title: 'Global shortcut Cmd+Shift+I for macOS Companion App',
    detail: 'Macbeth proposed adding Cmd+Shift+I as the default shortcut for quick capture window in the macOS menu bar app.',
    sourceText: 'Macbeth: For the Mac menu bar companion app, let us register `Cmd+Shift+I` globally. If pressed anywhere, it opens the quick note capture modal.\nNaeemudheen: Perfect, that avoids conflict with standard browser developer tools shortcuts.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C02PROD/p1754700000000500',
    sourceChannel: 'product-sync',
    personName: 'Macbeth',
    topic: 'mac-app',
    importance: 0.75,
    confidence: 0.88,
    messageCount: 3,
    ageDays: 3,
  },
  {
    kind: 'REFERENCE',
    title: 'Updated pricing tiers matrix for Q3',
    detail: 'Naeemudheen posted the revised pricing tier breakdown for pro vs team accounts.',
    sourceText: 'Naeemudheen: Here is the finalized Q3 pricing matrix with seat limits and Slack workspace connector bounds: https://docs.inlooped.app/pricing-q3-final.pdf',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C02PROD/p1754600000000600',
    sourceChannel: 'product-sync',
    personName: 'Naeemudheen',
    topic: 'pricing',
    importance: 0.6,
    confidence: 0.85,
    messageCount: 1,
    ageDays: 4,
  },

  // --- #support-escalations channel ---
  {
    kind: 'TASK',
    title: 'Investigate payment webhook failures in production',
    detail: 'Macbeth flagged 3 failed Stripe checkout webhook events from earlier today due to database transaction timeout.',
    sourceText: 'Macbeth: @naeemudheen 3 customers reported payment confirmation hanging at 99%. Looks like the Stripe webhook handler is timing out waiting for DB connection pool.\nNaeemudheen: Looking at the connection pool metrics now. Looks like pool size was capped at 10.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C03SUPP/p1754500000000700',
    sourceChannel: 'support-escalations',
    personName: 'Macbeth',
    topic: 'payments',
    importance: 0.95,
    confidence: 0.96,
    messageCount: 6,
    ageDays: 0,
    isPinned: true,
  },
  {
    kind: 'WAITING',
    title: 'Staging environment credentials from Macbeth',
    detail: 'You asked Macbeth to generate new access keys for the staging Postgres instance.',
    sourceText: 'Naeemudheen: @macbeth could you drop the updated staging DB credentials when you get a chance? Blocked on running migration smoke tests.\nMacbeth: Will rotate keys and post to 1Password vault in 10 mins.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C03SUPP/p1754400000000800',
    sourceChannel: 'support-escalations',
    personName: 'Macbeth',
    topic: 'staging',
    importance: 0.8,
    confidence: 0.93,
    messageCount: 2,
    ageDays: 2,
  },

  // --- #design-review channel ---
  {
    kind: 'TASK',
    title: 'Fix RTL layout alignment in feed items',
    detail: 'Macbeth noted right-to-left language text overflows container margins in the surface feed card UI.',
    sourceText: 'Macbeth: RTL support test in feed card layout: Arabic and Hebrew titles wrap poorly on smaller displays.\nNaeemudheen: I will adjust the flexbox container properties and add `dir="auto"` attribute to item titles.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/C04DSGN/p1754300000000900',
    sourceChannel: 'design-review',
    personName: 'Macbeth',
    topic: 'ui-design',
    importance: 0.5,
    confidence: 0.82,
    messageCount: 3,
    ageDays: 5,
  },

  // --- DM naeemudheen <-> macbeth ---
  {
    kind: 'REMEMBER',
    title: 'Review Macbeth\'s PR on rate limiting middleware',
    detail: 'Macbeth asked you directly in DM to review PR #142 before end of day.',
    sourceText: 'Macbeth: DM: Hey Naeem, whenever you have 5 mins, please review PR #142 for the API rate limiter. Want to get it into the nightly build.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/D05DM/p1754200000001000',
    sourceChannel: 'directmessage',
    personName: 'Macbeth',
    topic: 'code-review',
    importance: 0.9,
    confidence: 0.97,
    messageCount: 2,
    ageDays: 0,
    isPinned: true,
  },
  {
    kind: 'REMEMBER',
    title: 'Enable Slack Socket Mode for local webhook testing',
    detail: 'Quick note from Naeemudheen to set SLACK_SOCKET_MODE=true in local .env when running without public domain.',
    sourceText: 'Naeemudheen: DM: Remember to set `SLACK_APP_TOKEN` in `.env` to test Socket Mode locally without relying on ngrok tunnels.',
    sourceUrl: 'https://app.slack.com/client/T08DEMO/D05DM/p1754100000001100',
    sourceChannel: 'directmessage',
    personName: 'Naeemudheen',
    topic: 'slack-config',
    importance: 0.7,
    confidence: 0.9,
    messageCount: 1,
    ageDays: 1,
  },
];

async function main() {
  console.log('Seeding Slack test data for Naeemudheen and Macbeth...');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const user = await prisma.users.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      slackEnabled: true,
      slackUserId: 'U08NAEEM',
      slackTeamId: 'T08DEMO',
      name: 'Naeem',
    },
    create: {
      email: DEMO_EMAIL,
      password: passwordHash,
      name: 'Naeem',
      slackUserId: 'U08NAEEM',
      slackTeamId: 'T08DEMO',
      slackEnabled: true,
      slackTimezone: 'Asia/Kolkata',
    },
  });

  console.log(`Target User ID: ${user.id} (${user.email})`);

  // Clear existing items for clean deterministic seeding
  await prisma.workItem.deleteMany({ where: { userId: user.id } });

  let insertedCount = 0;

  for (const item of SLACK_TEST_ITEMS) {
    const occurredAt = daysAgo(item.ageDays);
    const scorable: ScorableItem = {
      kind: item.kind,
      status: item.status ?? 'OPEN',
      importance: item.importance,
      messageCount: item.messageCount ?? 1,
      occurredAt,
      lastSurfacedAt: null,
      personName: item.personName,
    };

    const surfaceScore = computeSurfaceScore(scorable, new Date(now));

    await prisma.workItem.create({
      data: {
        userId: user.id,
        kind: item.kind,
        status: item.status ?? 'OPEN',
        title: item.title,
        detail: item.detail,
        sourceText: item.sourceText,
        sourceHash: sourceHash(user.id, item.sourceText),
        sourceApp: 'slack',
        sourceUrl: item.sourceUrl || `https://app.slack.com/client/T08DEMO/${item.sourceChannel}`,
        sourceChannel: item.sourceChannel,
        personName: item.personName,
        topic: item.topic,
        importance: item.importance,
        confidence: item.confidence,
        messageCount: item.messageCount || 1,
        isPinned: item.isPinned || false,
        surfaceScore,
        occurredAt,
      },
    });
    insertedCount++;
  }

  console.log(`Successfully seeded ${insertedCount} Slack test work items involving Naeemudheen & Macbeth!`);
}

main()
  .catch((err) => {
    console.error('Error seeding Slack test data:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
