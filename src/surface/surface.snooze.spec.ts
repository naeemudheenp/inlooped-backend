import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SurfaceService } from './surface.service';

const NOW = new Date('2026-11-09T15:00:00Z'); // Monday 10:00 New York

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    userId: 7,
    kind: 'TASK',
    status: 'OPEN',
    title: 'Review proposal',
    detail: null,
    sourceUrl: null,
    sourceApp: 'slack',
    sourceChannel: null,
    personName: null,
    messageCount: 1,
    importance: 0.5,
    isPinned: false,
    occurredAt: new Date('2026-11-08T12:00:00Z'),
    snoozedUntil: null as Date | null,
    resolvedAt: null as Date | null,
    ...overrides,
  };
}

function setup(item = row(), tz = 'America/New_York') {
  const prisma = {
    users: {
      findUnique: jest.fn().mockResolvedValue({
        slackEnabled: true,
        slackTimezone: tz,
        teamsEnabled: false,
        teamsTimezone: 'UTC',
      }),
    },
    workItem: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === item.id && where.userId === item.userId ? item : null,
      ),
      findMany: jest.fn().mockResolvedValue([item]),
      update: jest.fn(async ({ data }: any) => Object.assign(item, data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== item.id || where.userId !== item.userId) return { count: 0 };
        Object.assign(item, data);
        return { count: 1 };
      }),
    },
  };
  return { service: new SurfaceService(prisma as any), prisma, item };
}

describe('SurfaceService snooze', () => {
  it('snoozes to a preset in the stored time zone', async () => {
    const { service, item } = setup();
    const until = await service.snoozeToPreset(7, 'item-1', 'tomorrow', undefined, NOW);
    expect(until.toISOString()).toBe('2026-11-10T14:00:00.000Z');
    expect(item.snoozedUntil).toEqual(until);
  });

  it('lets an explicit browser time zone win', async () => {
    const { service, prisma } = setup();
    const until = await service.snoozeToPreset(7, 'item-1', 'tomorrow', 'Asia/Kolkata', NOW);
    expect(until.toISOString()).toBe('2026-11-10T03:30:00.000Z');
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });

  it('rejects "tonight" after 6 pm', async () => {
    const { service } = setup();
    const evening = new Date('2026-11-09T23:30:00Z');
    await expect(
      service.snoozeToPreset(7, 'item-1', 'tonight', undefined, evening),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unsnoozes by waking the item now', async () => {
    const { service, item } = setup(row({ snoozedUntil: new Date('2026-11-16T14:00:00Z') }));
    const result = await service.unsnooze(7, 'item-1', NOW);
    expect(item.snoozedUntil).toEqual(NOW);
    expect(result.snoozedUntil).toBe(NOW.toISOString());
  });

  it('leaves an item that is not snoozed alone', async () => {
    const { service, prisma } = setup();
    await service.unsnooze(7, 'item-1', NOW);
    expect(prisma.workItem.update).not.toHaveBeenCalled();
  });

  it("can't unsnooze another user's item", async () => {
    const { service } = setup();
    await expect(service.unsnooze(99, 'item-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists only items snoozed into the future', async () => {
    const { service, prisma } = setup();
    await service.listSnoozed(7, NOW);
    const args = (prisma.workItem.findMany.mock.calls[0] as any)[0];
    expect(args.where.snoozedUntil).toEqual({ gt: NOW });
    expect(args.where.status).toEqual({ not: 'DISMISSED' });
    expect(args.orderBy).toEqual({ snoozedUntil: 'asc' });
  });

  it('marks done idempotently — a second click never reopens', async () => {
    const { service, item, prisma } = setup();
    await service.markDone(7, 'item-1');
    expect(item.status).toBe('RESOLVED');
    await service.markDone(7, 'item-1');
    expect(item.status).toBe('RESOLVED');
    expect(prisma.workItem.update).toHaveBeenCalledTimes(1);
  });
});
