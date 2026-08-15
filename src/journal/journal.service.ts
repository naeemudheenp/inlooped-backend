import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface JournalEntryView {
  id: string;
  /** YYYY-MM-DD */
  day: string;
  body: string;
  updatedAt: Date;
}

/**
 * Journal is a notebook, not an input to the agent.
 *
 * Nothing here classifies, scores, or surfaces. Entries never become work
 * items and never reach the model — if the user wanted the assistant to know
 * something, they would have forwarded it. Keeping this boundary hard is what
 * makes the journal safe to write in.
 */
@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: number, day: string): Promise<JournalEntryView | null> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { userId_day: { userId, day: toDate(day) } },
    });
    return entry ? view(entry) : null;
  }

  /** Autosave target. Empty body deletes rather than leaving a blank row. */
  async upsert(userId: number, day: string, body: string): Promise<JournalEntryView | null> {
    const date = toDate(day);
    const trimmed = body.trim();

    if (!trimmed) {
      await this.prisma.journalEntry
        .delete({ where: { userId_day: { userId, day: date } } })
        .catch(() => undefined); // nothing there is a fine outcome
      return null;
    }

    const entry = await this.prisma.journalEntry.upsert({
      where: { userId_day: { userId, day: date } },
      create: { userId, day: date, body: trimmed },
      update: { body: trimmed },
    });
    return view(entry);
  }

  async list(userId: number, limit = 30): Promise<JournalEntryView[]> {
    const entries = await this.prisma.journalEntry.findMany({
      where: { userId },
      orderBy: { day: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return entries.map(view);
  }
}

function view(e: { id: string; day: Date; body: string; updatedAt: Date }): JournalEntryView {
  return { id: e.id, day: e.day.toISOString().slice(0, 10), body: e.body, updatedAt: e.updatedAt };
}

/** Dates are stored as DATE; parse as UTC midnight so no timezone shifts the day. */
function toDate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid day "${day}", expected YYYY-MM-DD`);
  }
  return new Date(`${day}T00:00:00.000Z`);
}
