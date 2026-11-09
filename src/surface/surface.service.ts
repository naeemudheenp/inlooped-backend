import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WorkItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MIN_SURFACE_SCORE,
  computeSurfaceScore,
  isDormant,
  metaLabel,
} from './surface.scoring';

export interface SurfacedItem {
  id: string;
  title: string;
  detail: string | null;
  meta: string;
  kind: string;
  status: string;
  sourceUrl: string | null;
  sourceApp: string;
  sourceChannel: string | null;
  personName: string | null;
  messageCount: number;
  isPinned: boolean;
  occurredAt: string;
  snoozedUntil: string | null;
}

export interface GroupedSurfaceFeed {
  pinned: SurfacedItem[];
  today: SurfacedItem[];
  recent: SurfacedItem[];
}

const DEFAULT_LIMIT = 6;

export function notSnoozed(now: Date = new Date()) {
  return { OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] };
}

@Injectable()
export class SurfaceService {
  private readonly logger = new Logger(SurfaceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grouped surface feed: Pinned at top, Today's items, and Recent active items.
   * Includes both OPEN and RESOLVED items so resolved items remain visible.
   */
  async getFeed(userId: number, targetDate?: string): Promise<GroupedSurfaceFeed> {
    const now = new Date();
    const whereClause: any = {
      userId,
      status: { in: ['OPEN', 'RESOLVED'] },
      AND: [notSnoozed(now)],
    };

    let startOfTargetDate: Date;
    let endOfTargetDate: Date | null = null;

    if (targetDate) {
      startOfTargetDate = new Date(targetDate);
      endOfTargetDate = new Date(startOfTargetDate);
      endOfTargetDate.setDate(endOfTargetDate.getDate() + 1);

      whereClause.AND.push({
        OR: [
          { occurredAt: { gte: startOfTargetDate, lt: endOfTargetDate } },
          { snoozedUntil: { gte: startOfTargetDate, lt: endOfTargetDate } },
        ],
      });
    } else {
      startOfTargetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    const inTargetDay = (d: Date | null) =>
      !!d && d >= startOfTargetDate && (!endOfTargetDate || d < endOfTargetDate);

    const allItems = await this.prisma.workItem.findMany({
      where: whereClause,
      orderBy: [{ isPinned: 'desc' }, { occurredAt: 'desc' }],
      take: 50,
    });

    const pinned: SurfacedItem[] = [];
    const today: SurfacedItem[] = [];
    const recent: SurfacedItem[] = [];

    for (const item of allItems) {
      const surfaced = this.present(item);
      if (item.isPinned) {
        pinned.push(surfaced);
      } else if (inTargetDay(item.occurredAt) || inTargetDay(item.snoozedUntil)) {
        today.push(surfaced);
      } else {
        recent.push(surfaced);
      }
    }

    return { pinned, today, recent };
  }

  async today(userId: number, limit = DEFAULT_LIMIT, targetDate?: string): Promise<SurfacedItem[]> {
    const whereClause: any = {
      userId,
      status: { in: ['OPEN', 'RESOLVED'] },
      AND: [notSnoozed()],
    };

    if (targetDate) {
      const start = new Date(targetDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      whereClause.AND.push({
        OR: [
          { occurredAt: { gte: start, lt: end } },
          { snoozedUntil: { gte: start, lt: end } },
        ],
      });
    }

    const items = await this.prisma.workItem.findMany({
      where: whereClause,
      orderBy: [{ isPinned: 'desc' }, { surfaceScore: 'desc' }],
      take: limit,
    });

    return items.map((i) => this.present(i));
  }

  async topOpen(userId: number, limit = 5): Promise<SurfacedItem[]> {
    const items = await this.prisma.workItem.findMany({
      where: { userId, status: 'OPEN', AND: [notSnoozed()] },
      orderBy: [{ isPinned: 'desc' }, { surfaceScore: 'desc' }],
      take: limit,
    });
    return items.map((i) => this.present(i));
  }

  async togglePin(userId: number, itemId: string): Promise<boolean> {
    const item = await this.prisma.workItem.findFirst({
      where: { id: itemId, userId },
    });
    if (!item) return false;

    const newPinned = !item.isPinned;
    await this.prisma.workItem.update({
      where: { id: itemId },
      data: { isPinned: newPinned },
    });
    return newPinned;
  }

  present(item: WorkItem): SurfacedItem {
    return {
      id: item.id,
      title: item.title,
      detail: item.detail,
      meta: metaLabel(item),
      kind: item.kind,
      status: item.status,
      sourceUrl: item.sourceUrl,
      sourceApp: item.sourceApp,
      sourceChannel: item.sourceChannel,
      personName: item.personName,
      messageCount: item.messageCount,
      isPinned: Boolean(item.isPinned),
      occurredAt: item.occurredAt.toISOString(),
      snoozedUntil: item.snoozedUntil ? item.snoozedUntil.toISOString() : null,
    };
  }

  /**
   * Scores are a function of age, so they go stale on their own even when no
   * row changes. This is the only thing that needs a schedule — and it is pure
   * arithmetic, so the nightly pass costs nothing but a few UPDATEs.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async rescoreAll(): Promise<number> {
    const items = await this.prisma.workItem.findMany({ where: { status: 'OPEN' } });
    const now = new Date();
    let changed = 0;

    for (const item of items) {
      const next = computeSurfaceScore(item, now);
      if (Math.abs(next - item.surfaceScore) < 0.0001) continue;
      await this.prisma.workItem.update({
        where: { id: item.id },
        data: { surfaceScore: next },
      });
      changed += 1;
    }

    this.logger.log(`Rescored ${changed}/${items.length} open items`);
    return changed;
  }

  async resolve(userId: number, itemId: string): Promise<string> {
    const item = await this.prisma.workItem.findFirst({
      where: { id: itemId, userId },
    });
    if (!item) return 'OPEN';

    const nextStatus = item.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED';
    await this.prisma.workItem.update({
      where: { id: itemId },
      data: {
        status: nextStatus,
        resolvedAt: nextStatus === 'RESOLVED' ? new Date() : null,
        surfaceScore: nextStatus === 'RESOLVED' ? 0 : computeSurfaceScore(item),
      },
    });
    return nextStatus;
  }

  async dismiss(userId: number, itemId: string): Promise<void> {
    await this.prisma.workItem.updateMany({
      where: { id: itemId, userId },
      data: { status: 'DISMISSED', surfaceScore: 0 },
    });
  }

  async snooze(userId: number, itemId: string, until: Date, now: Date = new Date()): Promise<Date> {
    if (Number.isNaN(until.getTime())) {
      throw new BadRequestException('until must be a valid date');
    }
    if (until.getTime() <= now.getTime()) {
      throw new BadRequestException('until must be in the future');
    }

    const { count } = await this.prisma.workItem.updateMany({
      where: { id: itemId, userId, status: { not: 'DISMISSED' } },
      data: { snoozedUntil: until },
    });
    if (count === 0) throw new NotFoundException('Item not found');
    return until;
  }

  /** Exposed for the "may have gone away" copy in tests. */
  isDormant(item: WorkItem): boolean {
    return isDormant(item);
  }
}
