/**
 * Seeds the demo account so the app is populated and reviewable on first run
 * with no LLM_PROVIDER set — the whole product except classification and
 * answering is deterministic, so it demos fine with the key absent.
 *
 *   npx prisma db seed
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

interface SeedItem {
  kind: ItemKind;
  status?: ItemStatus;
  title: string;
  detail: string;
  sourceText: string;
  sourceUrl?: string;
  sourceChannel?: string;
  personName?: string;
  topic?: string;
  importance: number;
  confidence: number;
  messageCount?: number;
  ageDays: number;
}

/**
 * The first four are the screenshot, verbatim. The last two exist to make the
 * recency × importance ranking testable: same age, opposite importance — the
 * blocker must keep surfacing while the "might be useful" link falls away.
 */
const ITEMS: SeedItem[] = [
  {
    kind: 'REFERENCE',
    title: 'The pricing doc Dana shared',
    detail:
      'Dana shared the updated pricing doc and asked for a read before the sync. You have not opened it yet.',
    sourceText:
      'Sharing the updated pricing doc ahead of the sync — would appreciate a read before Monday. https://docs.internal/pricing-v4',
    sourceUrl: 'https://slack.com/archives/C02PRICING/p1754300000000100',
    sourceChannel: 'pricing',
    personName: 'Dana',
    topic: 'pricing',
    importance: 0.65,
    confidence: 0.88,
    ageDays: 5,
  },
  {
    kind: 'TASK',
    title: 'Checkout timeouts',
    detail:
      'There are 4 related messages from Slack. You mentioned you would look into this.',
    sourceText:
      'Seeing checkout timeouts again in production — the payment step hangs for about 30 seconds and then fails. Third report this week.',
    sourceUrl: 'https://slack.com/archives/C01PAYMENTS/p1754500000000200',
    sourceChannel: 'payments',
    topic: 'checkout',
    importance: 0.85,
    confidence: 0.91,
    messageCount: 4,
    ageDays: 2,
  },
  {
    kind: 'TASK',
    title: 'The onboarding issue',
    detail:
      'Raised a while ago and nothing has moved since. It may have resolved itself — worth a quick check before you spend time on it.',
    sourceText:
      'A couple of new workspaces got stuck on the onboarding invite step. Not sure yet whether it is the email provider or our side.',
    sourceUrl: 'https://slack.com/archives/C03ONBOARD/p1752900000000300',
    sourceChannel: 'onboarding',
    topic: 'onboarding',
    importance: 0.5,
    confidence: 0.72,
    ageDays: 24,
  },
  {
    kind: 'WAITING',
    title: 'Staging credentials from Ravi',
    detail:
      'You asked Ravi for staging credentials and have not heard back since.',
    sourceText:
      'Ravi — could you send over the staging credentials when you get a moment? Blocked on the integration test run until then.',
    sourceUrl: 'https://slack.com/archives/D04RAVI/p1754400000000400',
    sourceChannel: 'ravi',
    personName: 'Ravi',
    topic: 'staging',
    importance: 0.8,
    confidence: 0.94,
    ageDays: 3,
  },

  // --- ranking fixtures: same age, opposite importance ---------------------
  {
    kind: 'TASK',
    title: 'RTL support before release',
    detail:
      'Priya asked that right-to-left layout support ship before the release. Nothing has moved on it since.',
    sourceText:
      'Please make sure RTL support is included before release — we committed to it for the Gulf launch.',
    sourceUrl: 'https://slack.com/archives/C05RELEASE/p1749000000000500',
    sourceChannel: 'release',
    personName: 'Priya',
    topic: 'release',
    importance: 0.9,
    confidence: 0.86,
    ageDays: 60,
  },
  {
    kind: 'REFERENCE',
    title: 'A post on onboarding checklists',
    detail: 'Someone shared this as possibly useful whenever onboarding gets picked up again.',
    sourceText:
      'This might be useful when we work on onboarding — nice breakdown of activation checklists. https://example.com/onboarding-checklists',
    sourceUrl: 'https://slack.com/archives/C03ONBOARD/p1749100000000600',
    sourceChannel: 'onboarding',
    topic: 'onboarding release',
    importance: 0.15,
    confidence: 0.7,
    ageDays: 60,
  },
];

const JOURNAL: { ageDays: number; body: string }[] = [
  {
    ageDays: 0,
    body: 'Dana called the migration doc "the clearest thing anyone has written about this system", which I did not expect. Worth remembering that the version people liked was the one where I cut the background section entirely.',
  },
  {
    ageDays: 3,
    body: 'Long architecture review. I think the bus is right, but I could not defend it well in the room — the argument I actually believe is about failure isolation, and I kept reaching for throughput numbers instead. Write that down properly before the next one.',
  },
  {
    ageDays: 4,
    body: 'Northwind assumed the retry limit was configurable and built around it. Nobody said otherwise, so that is on us. Worth checking which other defaults people are treating as settings.',
  },
  {
    ageDays: 5,
    body: 'Pricing sync. Nothing decided. The blocker is that we still cannot say what a seat means for an org with contractors, and everything downstream waits on that.',
  },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const user = await prisma.users.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      password: passwordHash,
      name: 'Naeem',
      slackTimezone: 'Asia/Kolkata',
    },
  });

  // Idempotent: re-seeding replaces the demo rows rather than stacking them.
  await prisma.workItem.deleteMany({ where: { userId: user.id } });
  await prisma.journalEntry.deleteMany({ where: { userId: user.id } });
  await prisma.agentQuery.deleteMany({ where: { userId: user.id } });

  for (const item of ITEMS) {
    const occurredAt = daysAgo(item.ageDays);
    const scorable: ScorableItem = {
      kind: item.kind,
      status: item.status ?? 'OPEN',
      importance: item.importance,
      messageCount: item.messageCount ?? 1,
      occurredAt,
      lastSurfacedAt: null,
      personName: item.personName ?? null,
    };

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
        sourceUrl: item.sourceUrl,
        sourceChannel: item.sourceChannel,
        personName: item.personName,
        topic: item.topic,
        importance: item.importance,
        confidence: item.confidence,
        messageCount: item.messageCount ?? 1,
        occurredAt,
        surfaceScore: computeSurfaceScore(scorable),
      },
    });
  }

  for (const entry of JOURNAL) {
    const d = daysAgo(entry.ageDays);
    const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    await prisma.journalEntry.create({
      data: { userId: user.id, day, body: entry.body },
    });
  }

  const surfaced = await prisma.workItem.findMany({
    where: { userId: user.id },
    orderBy: { surfaceScore: 'desc' },
    select: { title: true, surfaceScore: true, importance: true, occurredAt: true },
  });

  console.log(`\nSeeded ${DEMO_EMAIL} (password: ${DEMO_PASSWORD})`);
  console.log(`  ${ITEMS.length} work items, ${JOURNAL.length} journal entries\n`);
  console.log('  Things for today, in order:');
  for (const s of surfaced) {
    const age = Math.round((now - s.occurredAt.getTime()) / DAY);
    console.log(
      `    ${s.surfaceScore.toFixed(3)}  imp ${s.importance.toFixed(2)}  ${String(age).padStart(2)}d  ${s.title}`,
    );
  }
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
