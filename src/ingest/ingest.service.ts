import { Inject, Injectable, Logger } from '@nestjs/common';
import { ItemKind, WorkItem } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_SERVICE, LlmService, LlmUnavailableError } from '../llm/llm.types';
import { CLASSIFY_SCHEMA, CLASSIFY_SYSTEM, ClassifyResult } from './classify.prompt';
import { computeSurfaceScore } from '../surface/surface.scoring';

export interface CaptureInput {
  userId: number;
  text: string;
  sourceApp?: string;
  sourceUrl?: string;
  sourceChannel?: string;
  occurredAt?: Date;
  /** Set by the /remember slash command — skips inference entirely. */
  forceKind?: ItemKind;
}

export type CaptureRoute =
  | 'duplicate' // exact hash match
  | 'command' // /remember — the command is the intent
  | 'trivial' // too short to be worth a call
  | 'near-duplicate' // trigram match against a recent item
  | 'classified' // reached the model
  | 'unclassified'; // model unavailable or failed; stored raw

export interface CaptureOutcome {
  item: WorkItem;
  route: CaptureRoute;
  /** True only when this capture actually spent tokens. */
  usedLlm: boolean;
}

/** Trigram similarity above this, within the window, counts as the same thing. */
const NEAR_DUPLICATE_THRESHOLD = 0.82;
const NEAR_DUPLICATE_WINDOW_DAYS = 14;

/** Below this many words there is nothing to understand. */
const TRIVIAL_WORD_COUNT = 4;

const REMEMBER_PREFIX = /^\/?remember[\s:,-]+/i;

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
  ) {}

  /**
   * FORWARD -> UNDERSTAND -> KEEP CONTEXT.
   *
   * A chain of gates, cheapest first. Every gate that fires is an API call that
   * never happens, which is where most of the cost saving actually comes from —
   * not from the model choice.
   */
  async capture(input: CaptureInput): Promise<CaptureOutcome> {
    const text = input.text.trim();
    if (!text) throw new Error('capture() called with empty text');

    const occurredAt = input.occurredAt ?? new Date();
    const hash = this.hash(input.userId, text);

    // Gate 1 — exact duplicate. Slack re-forwards land here constantly.
    const exact = await this.prisma.workItem.findUnique({
      where: { userId_sourceHash: { userId: input.userId, sourceHash: hash } },
    });
    if (exact) {
      return { item: await this.merge(exact, occurredAt), route: 'duplicate', usedLlm: false };
    }

    // Gate 2 — an explicit command. The command *is* the intent; there is
    // nothing left to infer, so this must never reach the model.
    if (input.forceKind === 'REMEMBER' || REMEMBER_PREFIX.test(text)) {
      const body = text.replace(REMEMBER_PREFIX, '').trim() || text;
      return {
        item: await this.store(input, {
          kind: 'REMEMBER',
          title: truncate(body, 80),
          detail: body.length > 80 ? body : null,
          importance: 0.9, // they asked for it by name; treat it as meant
          confidence: 1,
          personName: null,
          topic: null,
          hash,
          occurredAt,
        }),
        route: 'command',
        usedLlm: false,
      };
    }

    // Gate 3 — noise or trivial text (greetings, 'hi', 'dfda'). Skip DB persistence entirely.
    if (isTrivial(text)) {
      return {
        item: {
          id: 'trivial',
          userId: input.userId,
          kind: 'REFERENCE',
          status: 'DISMISSED',
          title: truncate(text, 80),
          detail: null,
          sourceText: text,
          sourceHash: hash,
          sourceApp: input.sourceApp ?? 'slack',
          sourceUrl: input.sourceUrl ?? null,
          sourceChannel: input.sourceChannel ?? null,
          personName: null,
          topic: null,
          confidence: 0,
          messageCount: 1,
          importance: 0,
          isPinned: false,
          surfaceScore: 0,
          lastSurfacedAt: null,
          occurredAt,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        } as WorkItem,
        route: 'trivial',
        usedLlm: false,
      };
    }

    // Gate 4 — near-duplicate: the same thing said slightly differently.
    const near = await this.findNearDuplicate(input.userId, text);
    if (near) {
      return { item: await this.merge(near, occurredAt), route: 'near-duplicate', usedLlm: false };
    }

    // Gate 5 — only now is a call justified.
    let classified: ClassifyResult | undefined;
    let usedLlm = false;
    if (this.llm.isAvailable()) {
      try {
        const res = await this.llm.complete<ClassifyResult>({
          system: CLASSIFY_SYSTEM,
          user: text,
          maxOutputTokens: 150,
          tier: 'cheap',
          jsonSchema: CLASSIFY_SCHEMA as unknown as Record<string, unknown>,
          label: 'classify',
        });
        usedLlm = true;
        classified = normalize(res.json);
      } catch (err) {
        // Never lose the message because the model was unavailable.
        if (err instanceof LlmUnavailableError) {
          this.logger.warn(`classify unavailable, storing raw: ${err.message}`);
        } else {
          this.logger.error('classify failed, storing raw', err as Error);
        }
      }
    }

    if (!classified) {
      return {
        item: await this.store(input, {
          kind: 'REFERENCE',
          title: truncate(text, 80),
          detail: null,
          importance: 0.4,
          confidence: 0,
          personName: null,
          topic: null,
          hash,
          occurredAt,
        }),
        route: 'unclassified',
        usedLlm,
      };
    }

    return {
      item: await this.store(input, {
        kind: classified.kind,
        title: classified.title,
        detail: classified.detail,
        importance: classified.importance,
        confidence: classified.confidence,
        personName: classified.personName ?? null,
        topic: classified.topic ?? null,
        hash,
        occurredAt,
      }),
      route: 'classified',
      usedLlm,
    };
  }

  // -- internals -----------------------------------------------------------

  private hash(userId: number, text: string): string {
    const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
    return createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
  }

  /**
   * Trigram similarity over recent items. The GIN index on sourceText keeps
   * this cheap enough to run before every classify call.
   */
  private async findNearDuplicate(userId: number, text: string): Promise<WorkItem | null> {
    const since = new Date(Date.now() - NEAR_DUPLICATE_WINDOW_DAYS * 86_400_000);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "WorkItem"
      WHERE "userId" = ${userId}
        AND "occurredAt" >= ${since}
        AND similarity("sourceText", ${text}) > ${NEAR_DUPLICATE_THRESHOLD}
      ORDER BY similarity("sourceText", ${text}) DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return this.prisma.workItem.findUnique({ where: { id: rows[0].id } });
  }

  /** A repeat is evidence of heat, not a new item — bump, reopen if closed, and re-score. */
  private async merge(item: WorkItem, occurredAt: Date): Promise<WorkItem> {
    const messageCount = item.messageCount + 1;
    const next = { ...item, status: 'OPEN' as const, messageCount, occurredAt };
    return this.prisma.workItem.update({
      where: { id: item.id },
      data: {
        status: 'OPEN',
        messageCount,
        occurredAt,
        surfaceScore: computeSurfaceScore(next),
      },
    });
  }

  private async store(
    input: CaptureInput,
    fields: {
      kind: ItemKind;
      title: string;
      detail: string | null;
      importance: number;
      confidence: number;
      personName: string | null;
      topic: string | null;
      hash: string;
      occurredAt: Date;
    },
  ): Promise<WorkItem> {
    const scorable = {
      kind: fields.kind,
      status: 'OPEN' as const,
      importance: fields.importance,
      messageCount: 1,
      occurredAt: fields.occurredAt,
      lastSurfacedAt: null,
      personName: fields.personName,
    };

    return this.prisma.workItem.create({
      data: {
        userId: input.userId,
        kind: fields.kind,
        title: fields.title,
        detail: fields.detail,
        sourceText: input.text.trim(),
        sourceHash: fields.hash,
        sourceApp: input.sourceApp ?? 'slack',
        sourceUrl: input.sourceUrl,
        sourceChannel: input.sourceChannel,
        personName: fields.personName,
        topic: fields.topic,
        importance: clamp01(fields.importance),
        confidence: clamp01(fields.confidence),
        occurredAt: fields.occurredAt,
        surfaceScore: computeSurfaceScore(scorable),
      },
    });
  }
}

const GREETINGS_NOISE = new Set([
  'hi', 'hello', 'hey', 'dfda', 'test', 'testing', 'hi welcome', 'welcome', 'thanks', 'thank you', 'ok', 'okay', 'yep', 'nope', 'bye', 'good morning', 'good evening', 'good night'
]);

function isTrivial(text: string): boolean {
  const cleanText = text.trim().toLowerCase().replace(/<@[^>]+>/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleanText || GREETINGS_NOISE.has(cleanText)) return true;

  // A bare URL, or nothing but emoji and punctuation.
  if (/^https?:\/\/\S+$/i.test(text)) return true;
  if (!/[a-z]{2}/i.test(text)) return true;
  return false;
}

/** The model is not trusted to stay in range or in the enum. */
function normalize(raw: ClassifyResult | undefined): ClassifyResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const kind = ['TASK', 'WAITING', 'REFERENCE', 'REMEMBER'].includes(raw.kind)
    ? raw.kind
    : 'REFERENCE';
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined;
  if (!title) return undefined;

  return {
    kind,
    title: truncate(title, 120),
    detail: typeof raw.detail === 'string' ? raw.detail.trim() : '',
    personName: cleanWord(raw.personName),
    topic: cleanWord(raw.topic)?.toLowerCase(),
    importance: clamp01(Number(raw.importance)),
    confidence: clamp01(Number(raw.confidence)),
  };
}

function cleanWord(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'none') return undefined;
  return s.slice(0, 60);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
