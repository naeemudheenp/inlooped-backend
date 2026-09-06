import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkItem } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_SERVICE, LlmService, LlmUnavailableError } from '../llm/llm.types';
import { SurfaceService, SurfacedItem } from '../surface/surface.service';
import { ageLabel, isStale, sinceLabel } from '../surface/surface.scoring';
import { ANSWER_SYSTEM, PromptItem, buildAnswerUser } from './answer.prompt';

export type AnswerRoute =
  | 'cache' // identical question answered recently
  | 'router' // structural question answered from a query + template
  | 'retrieval' // rows found, but no model available to phrase them
  | 'llm' // the only route that spends tokens
  | 'empty'; // nothing matched

export interface AgentAnswer {
  answer: string;
  items: SurfacedItem[];
  /** Which path produced this. Only "llm" spent tokens. */
  route: AnswerRoute;
}

/** How long an identical question reuses its previous answer. */
const CACHE_TTL_MS = 15 * 60 * 1000;

const RETRIEVE_LIMIT = 8;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly surface: SurfaceService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
  ) {}

  async ask(userId: number, rawQuestion: string): Promise<AgentAnswer> {
    const question = rawQuestion.trim();
    if (!question) return { answer: 'Ask me anything about what you have sent.', items: [], route: 'empty' };

    // 1 — Answer cache. The suggestion pills are fixed strings, so they land
    // here almost every time after the first.
    const cached = await this.readCache(userId, question);
    if (cached && !cached.answer.trim().endsWith('(')) return cached;

    // 2 — Deterministic router. Two of the three suggested questions are
    // structural, not semantic: they are a WHERE clause, not a reading task.
    const routed = await this.route(userId, question);
    if (routed) {
      await this.writeCache(userId, question, routed);
      return routed;
    }

    // 3 — Retrieval. Costs nothing; blends relevance, recency and importance.
    const rows = await this.retrieve(userId, question);
    if (rows.length === 0) {
      return {
        answer: "I don't have anything on that yet.",
        items: [],
        route: 'empty',
      };
    }

    const items = rows.map((r) => this.surface.present(r));

    // 4 — The only step that spends tokens, over eight rows and nothing else.
    if (!this.llm.isAvailable()) {
      return { answer: this.describeWithoutModel(rows), items, route: 'retrieval' };
    }

    try {
      const res = await this.llm.complete({
        system: ANSWER_SYSTEM,
        user: buildAnswerUser(question, rows.map(toPromptItem)),
        maxOutputTokens: 4096,
        tier: 'strong',
        label: 'answer',
      });
      const answer: AgentAnswer = { answer: res.text.trim(), items, route: 'llm' };
      await this.writeCache(userId, question, answer);
      return answer;
    } catch (err) {
      if (err instanceof LlmUnavailableError) {
        this.logger.warn(`answer unavailable, falling back to retrieval: ${err.message}`);
      } else {
        this.logger.error('answer failed', err as Error);
      }
      // Degrade to the rows themselves rather than an error screen — the
      // retrieval was free and is still useful on its own.
      return { answer: this.describeWithoutModel(rows), items, route: 'retrieval' };
    }
  }

  // -- retrieval -----------------------------------------------------------

  /**
   * Relevance x recency x importance, all in SQL.
   *
   * Text rank alone would let a two-month-old row outrank a live one. The
   * half-life widens with importance (14 -> 44 days) for the same reason it
   * does when surfacing: an important old thing stays findable, a trivial old
   * thing does not. The 0.35 floor means age discounts a row without ever
   * excluding it outright.
   */
  private async retrieve(userId: number, question: string): Promise<WorkItem[]> {
    const ranked = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id,
             ts_rank_cd("searchVector", websearch_to_tsquery('english', ${question}))
               * exp(-EXTRACT(EPOCH FROM (now() - "occurredAt")) / (86400 * (14 + 30 * importance)))
               * (0.35 + 0.65 * importance)
               * CASE WHEN status = 'OPEN' THEN 1.0 ELSE 0.5 END AS ctx
      FROM "WorkItem"
      WHERE "userId" = ${userId}
        AND status <> 'DISMISSED'
        AND "searchVector" @@ websearch_to_tsquery('english', ${question})
      ORDER BY ctx DESC
      LIMIT ${RETRIEVE_LIMIT}
    `;

    if (ranked.length > 0) return this.hydrate(ranked.map((r) => r.id));

    // Typo fallback: trigram similarity finds near-matches and misspellings.
    const fuzzy = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id,
             GREATEST(similarity("title", ${question}), similarity("sourceText", ${question}))
               * exp(-EXTRACT(EPOCH FROM (now() - "occurredAt")) / (86400 * (14 + 30 * importance)))
               * (0.35 + 0.65 * importance) AS ctx
      FROM "WorkItem"
      WHERE "userId" = ${userId}
        AND status <> 'DISMISSED'
        AND (similarity("title", ${question}) > 0.08 OR similarity("sourceText", ${question}) > 0.08)
      ORDER BY ctx DESC
      LIMIT ${RETRIEVE_LIMIT}
    `;

    if (fuzzy.length > 0) return this.hydrate(fuzzy.map((r) => r.id));

    // Fallback: If no specific keyword matched, fetch recent OPEN items so the model has context to answer general questions.
    return this.prisma.workItem.findMany({
      where: { userId, status: 'OPEN' },
      orderBy: { occurredAt: 'desc' },
      take: RETRIEVE_LIMIT,
    });
  }

  /** $queryRaw returns ids only; re-read through Prisma to keep types honest. */
  private async hydrate(ids: string[]): Promise<WorkItem[]> {
    const rows = await this.prisma.workItem.findMany({ where: { id: { in: ids } } });
    const order = new Map(ids.map((id, i) => [id, i]));
    return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  // -- deterministic router -------------------------------------------------

  /**
   * Structural questions answered from a query and a template. No tokens.
   * This is why "What's still open?" and "Who am I waiting on?" are free.
   */
  private async route(userId: number, question: string): Promise<AgentAnswer | null> {
    const q = question.toLowerCase();

    if (/\b(who|whom)\b.*\bwait/.test(q) || /\bwaiting on\b/.test(q) || /\bblocked on\b/.test(q)) {
      const rows = await this.prisma.workItem.findMany({
        where: { userId, status: 'OPEN', kind: 'WAITING' },
        orderBy: { surfaceScore: 'desc' },
      });
      if (rows.length === 0) {
        return { answer: "You're not waiting on anyone right now.", items: [], route: 'router' };
      }
      return {
        answer: this.phraseWaiting(rows),
        items: rows.map((r) => this.surface.present(r)),
        route: 'router',
      };
    }

    if (/\b(still\s+)?open\b/.test(q) || /what'?s left|outstanding|on my plate/.test(q)) {
      const rows = await this.prisma.workItem.findMany({
        where: { userId, status: 'OPEN', kind: { in: ['TASK', 'WAITING', 'REMEMBER'] } },
        orderBy: { surfaceScore: 'desc' },
        take: RETRIEVE_LIMIT,
      });
      if (rows.length === 0) {
        return { answer: 'Nothing is open right now.', items: [], route: 'router' };
      }
      return {
        answer: this.phraseOpen(rows),
        items: rows.map((r) => this.surface.present(r)),
        route: 'router',
      };
    }

    return null;
  }

  private phraseWaiting(rows: WorkItem[]): string {
    const byPerson = new Map<string, WorkItem[]>();
    for (const r of rows) {
      const name = r.personName ?? 'someone';
      byPerson.set(name, [...(byPerson.get(name) ?? []), r]);
    }
    const parts = [...byPerson.entries()].map(([name, items]) => {
      const what = items.map((i) => lowerFirst(i.title)).join(' and ');
      return `${name} — ${what} (${sinceLabel(items[0].occurredAt)})`;
    });
    return parts.length === 1
      ? `You're waiting on ${parts[0]}.`
      : `You're waiting on ${byPerson.size} people:\n${parts.map((p) => `· ${p}`).join('\n')}`;
  }

  private phraseOpen(rows: WorkItem[]): string {
    const lead = rows
      .slice(0, 3)
      .map((r) => lowerFirst(r.title))
      .join(', ');
    const rest = rows.length - 3;
    const tail = rest > 0 ? `, and ${rest} more` : '';
    return `Still open: ${lead}${tail}.`;
  }

  /** Used when no provider is configured — the rows still answer the question. */
  private describeWithoutModel(rows: WorkItem[]): string {
    const titles = rows.slice(0, 3).map((r) => lowerFirst(r.title));
    if (titles.length === 1) return `The closest match is ${titles[0]}.`;
    return `Closest matches: ${titles.join(', ')}.`;
  }

  // -- cache ----------------------------------------------------------------

  private questionHash(userId: number, question: string): string {
    const normalized = question.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    return createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
  }

  private async readCache(userId: number, question: string): Promise<AgentAnswer | null> {
    const hit = await this.prisma.agentQuery.findFirst({
      where: {
        userId,
        questionHash: this.questionHash(userId, question),
        createdAt: { gte: new Date(Date.now() - CACHE_TTL_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!hit) return null;

    // Ignore broken or truncated cached answers (e.g., ends with '(' or lacks ending punctuation)
    const trimmed = hit.answer.trim();
    if (trimmed.endsWith('(') || trimmed.endsWith('[') || (!/[.!?"]$/.test(trimmed) && trimmed.length < 300)) {
      return null;
    }

    const ids = Array.isArray(hit.itemIds) ? (hit.itemIds as string[]) : [];
    const items = ids.length > 0 ? await this.hydrate(ids) : [];
    return { answer: hit.answer, items: items.map((i) => this.surface.present(i)), route: 'cache' };
  }

  private async writeCache(userId: number, question: string, answer: AgentAnswer): Promise<void> {
    await this.prisma.agentQuery.create({
      data: {
        userId,
        question,
        questionHash: this.questionHash(userId, question),
        answer: answer.answer,
        itemIds: answer.items.map((i) => i.id),
        route: answer.route,
      },
    });
  }
}

function toPromptItem(item: WorkItem): PromptItem {
  return {
    title: item.title,
    detail: item.detail,
    ageLabel: ageLabel(item.occurredAt),
    stale: isStale(item.occurredAt),
    kind: item.kind,
    status: item.status,
    personName: item.personName,
    messageCount: item.messageCount,
  };
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
