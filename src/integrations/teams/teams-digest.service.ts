import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { SurfaceService } from '../../surface/surface.service';
import { isWeekdayAt } from '../../common/time.util';
import { TeamsService } from './teams.service';
import { formatTeamsTodayDigest } from './teams-recap.format';

export const TODAY_DIGEST_HOUR = 9;
export const TODAY_DIGEST_LIMIT = 5;
/** Comfortably under a day (DST can make it 23h) and over the 1h send window. */
const DIGEST_GAP_MS = 20 * 3_600_000;

/**
 * Daily "Today" digest: the user's top five open items, posted to their Teams
 * channel at 9 am on weekdays in their Teams time zone. Opt-in, and skipped on
 * days with nothing open.
 */
@Injectable()
export class TeamsDigestService {
  private readonly logger = new Logger(TeamsDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly teams: TeamsService,
    private readonly surface: SurfaceService,
  ) {}

  @Cron('*/15 * * * *')
  async tick(now: Date = new Date()): Promise<number> {
    const users = await this.prisma.users.findMany({
      where: {
        teamsEnabled: true,
        teamsTodayDigestEnabled: true,
        teamsRefreshToken: { not: null },
        teamsTeamId: { not: null },
        teamsChannelId: { not: null },
      },
      select: { id: true, teamsTimezone: true },
    });

    let sent = 0;
    for (const user of users) {
      if (!isWeekdayAt(now, user.teamsTimezone, TODAY_DIGEST_HOUR)) continue;
      try {
        if (await this.sendIfDue(user.id, now)) sent += 1;
      } catch (err) {
        this.logger.error(`Teams Today digest failed for user ${user.id}`, err as Error);
      }
    }
    if (sent > 0) this.logger.log(`Sent ${sent} Teams Today digest(s)`);
    return sent;
  }

  /**
   * Claims today's slot first, so the four ticks inside the 9 o'clock hour
   * can't double-post and a day with nothing open stays skipped even if an
   * item arrives at 9:20. A failed send releases the claim for a retry.
   */
  async sendIfDue(userId: number, now: Date): Promise<boolean> {
    const { count } = await this.prisma.users.updateMany({
      where: {
        id: userId,
        OR: [
          { lastTeamsTodayDigestAt: null },
          { lastTeamsTodayDigestAt: { lt: new Date(now.getTime() - DIGEST_GAP_MS) } },
        ],
      },
      data: { lastTeamsTodayDigestAt: now },
    });
    if (count === 0) return false;

    try {
      const items = await this.surface.topOpen(userId, TODAY_DIGEST_LIMIT);
      if (items.length === 0) return false;
      await this.teams.sendMessage(
        userId,
        formatTeamsTodayDigest(items, process.env.FRONTEND_URL),
      );
      return true;
    } catch (err) {
      await this.prisma.users.updateMany({
        where: { id: userId, lastTeamsTodayDigestAt: now },
        data: { lastTeamsTodayDigestAt: null },
      });
      throw err;
    }
  }
}
