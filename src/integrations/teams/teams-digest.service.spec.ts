import { TeamsDigestService } from './teams-digest.service';

/** Just enough of users.updateMany to model the once-a-day claim. */
class FakePrisma {
  lastDigestAt: Date | null = null;
  enabledUsers = [{ id: 1, teamsTimezone: 'America/New_York' }];

  users = {
    findMany: jest.fn(async () => this.enabledUsers),
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.OR) {
        const gapCutoff: Date = where.OR[1].lastTeamsTodayDigestAt.lt;
        const free = this.lastDigestAt === null || this.lastDigestAt < gapCutoff;
        if (!free) return { count: 0 };
      } else if (this.lastDigestAt?.getTime() !== where.lastTeamsTodayDigestAt.getTime()) {
        return { count: 0 };
      }
      this.lastDigestAt = data.lastTeamsTodayDigestAt;
      return { count: 1 };
    }),
  };
}

const ITEMS = [{ id: 'a', title: 'Review proposal', meta: 'today' }];

function setup(items: unknown[] = ITEMS) {
  const prisma = new FakePrisma();
  const teams = { sendMessage: jest.fn().mockResolvedValue(undefined) };
  const surface = { topOpen: jest.fn().mockResolvedValue(items) };
  const service = new TeamsDigestService(prisma as any, teams as any, surface as any);
  return { service, prisma, teams, surface };
}

// Monday 9 Nov 2026 in New York (EST).
const MON_0900 = new Date('2026-11-09T14:00:00Z');
const MON_0915 = new Date('2026-11-09T14:15:00Z');
const MON_1000 = new Date('2026-11-09T15:00:00Z');
const SAT_0900 = new Date('2026-11-14T14:00:00Z');
const TUE_0900 = new Date('2026-11-10T14:00:00Z');

describe('Teams daily Today digest', () => {
  it('posts the top five at 9 am local on weekdays, once per day', async () => {
    const { service, teams, surface } = setup();

    expect(await service.tick(MON_0900)).toBe(1);
    expect(await service.tick(MON_0915)).toBe(0);
    expect(await service.tick(TUE_0900)).toBe(1);

    expect(surface.topOpen).toHaveBeenCalledWith(1, 5);
    expect(teams.sendMessage).toHaveBeenCalledTimes(2);
    expect(teams.sendMessage.mock.calls[0][1]).toContain('Your top 1 for today');
  });

  it('does not post outside 9 am or at weekends', async () => {
    const { service, teams } = setup();

    expect(await service.tick(MON_1000)).toBe(0);
    expect(await service.tick(SAT_0900)).toBe(0);
    expect(teams.sendMessage).not.toHaveBeenCalled();
  });

  it('only queries users who turned it on', async () => {
    const { service, prisma } = setup();
    await service.tick(MON_0900);
    expect((prisma.users.findMany.mock.calls[0] as any)[0].where.teamsTodayDigestEnabled).toBe(
      true,
    );
  });

  it('skips the day when nothing is open', async () => {
    const { service, teams, surface } = setup([]);

    expect(await service.tick(MON_0900)).toBe(0);
    surface.topOpen.mockResolvedValue(ITEMS); // something arrives at 9:10
    expect(await service.tick(MON_0915)).toBe(0);
    expect(teams.sendMessage).not.toHaveBeenCalled();
  });

  it('releases the claim when the post fails so the next tick retries', async () => {
    const { service, prisma, teams } = setup();
    teams.sendMessage.mockRejectedValueOnce(new Error('Graph 503'));

    expect(await service.tick(MON_0900)).toBe(0);
    expect(prisma.lastDigestAt).toBeNull();
    expect(await service.tick(MON_0915)).toBe(1);
  });
});
