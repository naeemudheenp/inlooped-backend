import { NudgeUser, WaitingNudgeService, clampNudgeDays } from './waiting-nudge.service';

const DAY = 86_400_000;
// Monday 9 Nov 2026, 10:00 in New York (EST).
const MON_1000 = new Date('2026-11-09T15:00:00Z');
const MON_1015 = new Date('2026-11-09T15:15:00Z');

function user(overrides: Partial<NudgeUser> = {}): NudgeUser {
  return {
    id: 1,
    slackEnabled: true,
    slackAccessToken: 'xoxb',
    slackUserId: 'U1',
    slackTimezone: 'America/New_York',
    teamsEnabled: true,
    teamsRefreshToken: 'refresh',
    teamsTeamId: 'team',
    teamsChannelId: 'channel',
    teamsTimezone: 'America/New_York',
    waitingNudgeSlack: true,
    waitingNudgeTeams: true,
    waitingNudgeDays: 3,
    ...overrides,
  };
}

class FakePrisma {
  lastNudgeAt: Date | null = null;
  users_: NudgeUser[] = [user()];
  items = [
    {
      id: 'w1',
      title: 'Vendor quote',
      personName: 'Ravi',
      sourceUrl: null,
      occurredAt: new Date(MON_1000.getTime() - 5 * DAY),
      nudgedAt: null as Date | null,
    },
  ];

  users = {
    findMany: jest.fn(async () => this.users_),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.OR) {
        const cutoff: Date = where.OR[1].lastWaitingNudgeAt.lt;
        if (this.lastNudgeAt !== null && this.lastNudgeAt >= cutoff) return { count: 0 };
      } else if (this.lastNudgeAt?.getTime() !== where.lastWaitingNudgeAt.getTime()) {
        return { count: 0 };
      }
      this.lastNudgeAt = data.lastWaitingNudgeAt;
      return { count: 1 };
    }),
  };

  workItem = {
    findMany: jest.fn(async ({ where }: any) =>
      this.items.filter((i) => i.nudgedAt === null && i.occurredAt <= where.occurredAt.lte),
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = this.items.filter((i) => where.id.in.includes(i.id) && i.nudgedAt === null);
      hit.forEach((i) => (i.nudgedAt = data.nudgedAt));
      return { count: hit.length };
    }),
  };
}

function setup() {
  const prisma = new FakePrisma();
  const slack = { sendBotMessage: jest.fn().mockResolvedValue(true) };
  const teams = { sendMessage: jest.fn().mockResolvedValue(undefined) };
  const service = new WaitingNudgeService(prisma as any, slack as any, teams as any);
  return { service, prisma, slack, teams };
}

describe('waiting-on nudges', () => {
  it('nudges quiet WAITING items via Slack and Teams at 10 am, once per item', async () => {
    const { service, prisma, slack, teams } = setup();

    expect(await service.tick(MON_1000)).toBe(1);

    expect(slack.sendBotMessage).toHaveBeenCalledWith(
      'xoxb',
      'U1',
      expect.stringContaining('No reply for 3+ days'),
    );
    expect(teams.sendMessage).toHaveBeenCalledWith(1, expect.stringContaining('Vendor quote'));
    expect(prisma.items[0].nudgedAt).toEqual(MON_1000);

    // Same item never again — even on another day.
    prisma.lastNudgeAt = null;
    expect(await service.tick(new Date(MON_1000.getTime() + DAY))).toBe(0);
    expect(slack.sendBotMessage).toHaveBeenCalledTimes(1);
  });

  it('queries open, un-nudged, unsnoozed WAITING items past the threshold', async () => {
    const { service, prisma } = setup();
    prisma.users_ = [user({ waitingNudgeDays: 7 })];

    await service.tick(MON_1000);

    const where = (prisma.workItem.findMany.mock.calls[0] as any)[0].where;
    expect(where).toMatchObject({ userId: 1, kind: 'WAITING', status: 'OPEN', nudgedAt: null });
    expect(where.occurredAt.lte).toEqual(new Date(MON_1000.getTime() - 7 * DAY));
    expect(where.AND).toHaveLength(1); // the not-snoozed filter
    // 5 days quiet < 7-day threshold.
    expect(prisma.items[0].nudgedAt).toBeNull();
  });

  it('runs only once in the 10 o\'clock hour and not at other times', async () => {
    const { service, slack } = setup();

    expect(await service.tick(new Date('2026-11-09T14:00:00Z'))).toBe(0); // 9:00
    expect(await service.tick(MON_1000)).toBe(1);
    expect(await service.tick(MON_1015)).toBe(0);
    expect(await service.tick(new Date('2026-11-14T15:00:00Z'))).toBe(0); // Saturday
    expect(slack.sendBotMessage).toHaveBeenCalledTimes(1);
  });

  it('sends only through the channels the user picked', async () => {
    const { service, prisma, slack, teams } = setup();
    prisma.users_ = [user({ waitingNudgeSlack: false })];

    expect(await service.tick(MON_1000)).toBe(1);
    expect(slack.sendBotMessage).not.toHaveBeenCalled();
    expect(teams.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('skips a Teams nudge when no channel is selected', async () => {
    const { service, prisma, slack, teams } = setup();
    prisma.users_ = [user({ teamsChannelId: null })];

    await service.tick(MON_1000);
    expect(slack.sendBotMessage).toHaveBeenCalledTimes(1);
    expect(teams.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps items un-nudged and retries when every channel fails', async () => {
    const { service, prisma, slack, teams } = setup();
    slack.sendBotMessage.mockResolvedValueOnce(false);
    teams.sendMessage.mockRejectedValueOnce(new Error('Graph 503'));

    expect(await service.tick(MON_1000)).toBe(0);
    expect(prisma.items[0].nudgedAt).toBeNull();
    expect(prisma.lastNudgeAt).toBeNull();

    expect(await service.tick(MON_1015)).toBe(1);
    expect(prisma.items[0].nudgedAt).toEqual(MON_1015);
  });

  it('counts a delivery when only one channel succeeds', async () => {
    const { service, prisma, teams } = setup();
    teams.sendMessage.mockRejectedValueOnce(new Error('Graph 503'));

    expect(await service.tick(MON_1000)).toBe(1);
    expect(prisma.items[0].nudgedAt).toEqual(MON_1000);
  });

  it('clamps the threshold to 1–30 days', () => {
    expect(clampNudgeDays(0)).toBe(1);
    expect(clampNudgeDays(45)).toBe(30);
    expect(clampNudgeDays('nope')).toBe(3);
    expect(clampNudgeDays(5)).toBe(5);
  });
});
