import { Injectable, Logger } from '@nestjs/common';
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
}

export interface GroupedSurfaceFeed {
  pinned: SurfacedItem[];
  today: SurfacedItem[];
  recent: SurfacedItem[];
}

const DEFAULT_LIMIT = 6;

@Injectable()
export class SurfaceService {
  private readonly logger = new Logger(SurfaceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grouped surface feed: Pinned at top, Today's items, and Recent active items.
   * Includes both OPEN and RESOLVED items so resolved items remain visible.
   */
  async getFeed(userId: number): Promise<GroupedSurfaceFeed> {
    const allItems = await this.prisma.workItem.findMany({
      where: { userId, status: { in: ['OPEN', 'RESOLVED'] } },
      orderBy: [{ isPinned: 'desc' }, { occurredAt: 'desc' }],
      take: 50,
    });

    const pinned: SurfacedItem[] = [];
    const today: SurfacedItem[] = [];
    const recent: SurfacedItem[] = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (const item of allItems) {
      const surfaced = this.present(item);
      if (item.isPinned) {
        pinned.push(surfaced);
      } else if (item.occurredAt >= startOfToday) {
        today.push(surfaced);
      } else {
        recent.push(surfaced);
      }
    }

    return { pinned, today, recent };
  }

  async today(userId: number, limit = DEFAULT_LIMIT): Promise<SurfacedItem[]> {
    const items = await this.prisma.workItem.findMany({
      where: { userId, status: { in: ['OPEN', 'RESOLVED'] } },
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

  /** Exposed for the "may have gone away" copy in tests. */
  isDormant(item: WorkItem): boolean {
    return isDormant(item);
  }
}
