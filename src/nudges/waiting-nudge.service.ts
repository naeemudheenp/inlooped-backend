import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SlackService } from '../integrations/slack/slack.service';
import { TeamsService } from '../integrations/teams/teams.service';
import { formatSlackWaitingNudge } from '../integrations/slack/slack-digest.format';
import { formatTeamsWaitingNudge } from '../integrations/teams/teams-recap.format';
import { notSnoozed } from '../surface/surface.service';
import { isWeekdayAt, preferredTimezone } from '../common/time.util';

export const NUDGE_HOUR = 10;
export const NUDGE_MIN_DAYS = 1;
export const NUDGE_MAX_DAYS = 30;
export const NUDGE_DEFAULT_DAYS = 3;
/** Keeps one message short; anything left over is picked up the next weekday. */
export const NUDGE_ITEM_LIMIT = 10;

const DAY_MS = 86_400_000;
const NUDGE_GAP_MS = 20 * 3_600_000;

export function clampNudgeDays(days: unknown): number {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n)) return NUDGE_DEFAULT_DAYS;
  return Math.min(NUDGE_MAX_DAYS, Math.max(NUDGE_MIN_DAYS, n));
}

const nudgeUserSelect = {
  id: true,
  slackEnabled: true,
  slackAccessToken: true,
  slackUserId: true,
  slackTimezone: true,
  teamsEnabled: true,
  teamsRefreshToken: true,
  teamsTeamId: true,
  teamsChannelId: true,
  teamsTimezone: true,
  waitingNudgeSlack: true,
  waitingNudgeTeams: true,
  waitingNudgeDays: true,
} as const;

export interface NudgeUser {
  id: number;
  slackEnabled: boolean;
  slackAccessToken: string | null;
  slackUserId: string | null;
  slackTimezone: string | null;
  teamsEnabled: boolean;
  teamsRefreshToken: string | null;
  teamsTeamId: string | null;
  teamsChannelId: string | null;
  teamsTimezone: string | null;
  waitingNudgeSlack: boolean;
  waitingNudgeTeams: boolean;
  waitingNudgeDays: number;
}

export function nudgeChannels(user: NudgeUser): { slack: boolean; teams: boolean } {
  return {
    slack: Boolean(
      user.waitingNudgeSlack && user.slackEnabled && user.slackAccessToken && user.slackUserId,
    ),
    teams: Boolean(
      user.waitingNudgeTeams &&
        user.teamsEnabled &&
        user.teamsRefreshToken &&
        user.teamsTeamId &&
        user.teamsChannelId,
    ),
  };
}

/**
 * "No reply for N+ days" reminders. At 10 am on weekdays (user's time zone),
 * open WAITING items whose last activity is at least N days old are sent via
 * Slack DM and/or the Teams channel. Each item is nudged once, ever.
 *
 * "Last activity" is occurredAt, which ingest bumps whenever the same thread
 * is forwarded again — so a fresh message resets the clock.
 */
@Injectable()
export class WaitingNudgeService {
  private readonly logger = new Logger(WaitingNudgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slack: SlackService,
    private readonly teams: TeamsService,
  ) {}

  @Cron('*/15 * * * *')
  async tick(now: Date = new Date()): Promise<number> {
    const users: NudgeUser[] = await this.prisma.users.findMany({
      where: {
        OR: [
          {
            waitingNudgeSlack: true,
            slackEnabled: true,
            slackAccessToken: { not: null },
            slackUserId: { not: null },
          },
          {
            waitingNudgeTeams: true,
            teamsEnabled: true,
            teamsRefreshToken: { not: null },
            teamsTeamId: { not: null },
            teamsChannelId: { not: null },
          },
        ],
      },
      select: nudgeUserSelect,
    });

    let sent = 0;
    for (const user of users) {
      if (!isWeekdayAt(now, preferredTimezone(user), NUDGE_HOUR)) continue;
      try {
        if (await this.nudgeUser(user, now)) sent += 1;
      } catch (err) {
        this.logger.error(`Waiting-on nudge failed for user ${user.id}`, err as Error);
      }
    }
    if (sent > 0) this.logger.log(`Sent ${sent} waiting-on nudge(s)`);
    return sent;
  }

  async nudgeUser(user: NudgeUser, now: Date): Promise<boolean> {
    const channels = nudgeChannels(user);
    if (!channels.slack && !channels.teams) return false;

    // Claim today's run so the other ticks in the 10 o'clock hour skip it.
    const { count } = await this.prisma.users.updateMany({
      where: {
        id: user.id,
        OR: [
          { lastWaitingNudgeAt: null },
          { lastWaitingNudgeAt: { lt: new Date(now.getTime() - NUDGE_GAP_MS) } },
        ],
      },
      data: { lastWaitingNudgeAt: now },
    });
    if (count === 0) return false;

    const days = clampNudgeDays(user.waitingNudgeDays);
    const items = await this.dueItems(user.id, days, now);
    if (items.length === 0) return false;

    const frontendUrl = process.env.FRONTEND_URL;
    let delivered = false;

    if (channels.slack) {
      try {
        delivered =
          (await this.slack.sendBotMessage(
            user.slackAccessToken!,
            user.slackUserId!,
            formatSlackWaitingNudge(items, days, now, frontendUrl),
          )) || delivered;
      } catch (err) {
        this.logger.error(`Slack waiting-on nudge failed for user ${user.id}`, err as Error);
      }
    }

    if (channels.teams) {
      try {
        await this.teams.sendMessage(
          user.id,
          formatTeamsWaitingNudge(items, days, now, frontendUrl),
        );
        delivered = true;
      } catch (err) {
        this.logger.error(`Teams waiting-on nudge failed for user ${user.id}`, err as Error);
      }
    }

    if (!delivered) {
      // Nothing went out — release the claim so the next tick retries, and
      // leave the items un-nudged.
      await this.prisma.users.updateMany({
        where: { id: user.id, lastWaitingNudgeAt: now },
        data: { lastWaitingNudgeAt: null },
      });
      return false;
    }

    await this.prisma.workItem.updateMany({
      where: { id: { in: items.map((i) => i.id) }, userId: user.id, nudgedAt: null },
      data: { nudgedAt: now },
    });
    return true;
  }

  /** Open WAITING items, quiet for `days`+ days, not snoozed, never nudged. Oldest first. */
  dueItems(userId: number, days: number, now: Date) {
    return this.prisma.workItem.findMany({
      where: {
        userId,
        kind: 'WAITING',
        status: 'OPEN',
        nudgedAt: null,
        occurredAt: { lte: new Date(now.getTime() - days * DAY_MS) },
        AND: [notSnoozed(now)],
      },
      orderBy: { occurredAt: 'asc' },
      take: NUDGE_ITEM_LIMIT,
      select: { id: true, title: true, personName: true, sourceUrl: true, occurredAt: true },
    });
  }

  async getSettings(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: nudgeUserSelect,
    });
    if (!user) return { error: 'User not found' };
    const ready = nudgeChannels({ ...user, waitingNudgeSlack: true, waitingNudgeTeams: true });
    return {
      viaSlack: user.waitingNudgeSlack,
      viaTeams: user.waitingNudgeTeams,
      days: user.waitingNudgeDays,
      minDays: NUDGE_MIN_DAYS,
      maxDays: NUDGE_MAX_DAYS,
      hour: NUDGE_HOUR,
      timezone: preferredTimezone(user),
      /** Whether each channel can actually deliver (connected, channel picked). */
      slackReady: ready.slack,
      teamsReady: ready.teams,
    };
  }

  async updateSettings(
    userId: number,
    settings: { viaSlack?: boolean; viaTeams?: boolean; days?: number },
  ) {
    const data: { waitingNudgeSlack?: boolean; waitingNudgeTeams?: boolean; waitingNudgeDays?: number } =
      {};
    if (typeof settings.viaSlack === 'boolean') data.waitingNudgeSlack = settings.viaSlack;
    if (typeof settings.viaTeams === 'boolean') data.waitingNudgeTeams = settings.viaTeams;
    if (settings.days !== undefined) data.waitingNudgeDays = clampNudgeDays(settings.days);
    await this.prisma.users.update({ where: { id: userId }, data });
    return this.getSettings(userId);
  }
}
