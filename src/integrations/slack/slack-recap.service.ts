import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SlackService } from './slack.service';
import { DigestItem, WeeklyRecap, formatWeeklyRecap, isRecapDue } from './slack-digest.format';

const DAY_MS = 86_400_000;
const MIN_GAP_MS = 6 * DAY_MS;

const digestSelect = { id: true, title: true, sourceUrl: true, personName: true } as const;

@Injectable()
export class SlackRecapService {
  private readonly logger = new Logger(SlackRecapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slack: SlackService,
  ) {}

  @Cron('*/15 * * * *')
  async tick(now: Date = new Date()): Promise<number> {
    const users = await this.prisma.users.findMany({
      where: {
        slackEnabled: true,
        weeklyRecapEnabled: true,
        slackAccessToken: { not: null },
        slackUserId: { not: null },
      },
      select: { id: true, slackTimezone: true, slackAccessToken: true, slackUserId: true },
    });

    let sent = 0;
    for (const user of users) {
      if (!isRecapDue(now, user.slackTimezone)) continue;
      try {
        if (await this.sendIfNotSent(user, now)) sent += 1;
      } catch (err) {
        this.logger.error(`Weekly recap failed for user ${user.id}`, err as Error);
      }
    }
    if (sent > 0) this.logger.log(`Sent ${sent} weekly recap(s)`);
    return sent;
  }

  async buildRecap(userId: number, now: Date = new Date()): Promise<WeeklyRecap> {
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const [resolved, waiting, pinned] = await Promise.all([
      this.prisma.workItem.findMany({
        where: { userId, status: 'RESOLVED', resolvedAt: { gte: weekAgo, lte: now } },
        orderBy: { resolvedAt: 'desc' },
        select: digestSelect,
      }),
      this.prisma.workItem.findMany({
        where: { userId, status: 'OPEN', kind: 'WAITING' },
        orderBy: { surfaceScore: 'desc' },
        select: digestSelect,
      }),
      this.prisma.workItem.findMany({
        where: { userId, isPinned: true, status: { not: 'DISMISSED' } },
        orderBy: { occurredAt: 'desc' },
        select: digestSelect,
      }),
    ]);
    return { resolved, waiting, pinned } as {
      resolved: DigestItem[];
      waiting: DigestItem[];
      pinned: DigestItem[];
    };
  }

  private async sendIfNotSent(
    user: { id: number; slackAccessToken: string | null; slackUserId: string | null },
    now: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.users.updateMany({
      where: {
        id: user.id,
        OR: [
          { lastWeeklyRecapAt: null },
          { lastWeeklyRecapAt: { lt: new Date(now.getTime() - MIN_GAP_MS) } },
        ],
      },
      data: { lastWeeklyRecapAt: now },
    });
    if (count === 0) return false;

    const recap = await this.buildRecap(user.id, now);
    const text = formatWeeklyRecap(recap, process.env.FRONTEND_URL);
    await this.slack.sendBotMessage(user.slackAccessToken!, user.slackUserId!, text);
    return true;
  }
}
