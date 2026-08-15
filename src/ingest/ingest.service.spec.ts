import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_SERVICE, LlmService } from '../llm/llm.types';
import { IngestService } from './ingest.service';

/**
 * These are the cost model's load-bearing assertions.
 *
 * The claim is that most forwarded messages never reach a model. If a gate
 * regresses, nothing breaks and no test fails anywhere else — the bill just
 * quietly goes up. So each gate asserts the call count explicitly.
 */

interface Row {
  id: string;
  userId: number;
  sourceHash: string;
  sourceText: string;
  kind: string;
  messageCount: number;
  occurredAt: Date;
  [k: string]: unknown;
}

/** Minimal in-memory stand-in — enough surface for the gate chain. */
class FakePrisma {
  rows: Row[] = [];
  /** Controls whether the trigram gate reports a near-duplicate. */
  nearDuplicateId: string | null = null;

  workItem = {
    findUnique: async ({ where }: any): Promise<Row | null> => {
      if (where.userId_sourceHash) {
        const { userId, sourceHash } = where.userId_sourceHash;
        return this.rows.find((r) => r.userId === userId && r.sourceHash === sourceHash) ?? null;
      }
      return this.rows.find((r) => r.id === where.id) ?? null;
    },
    create: async ({ data }: any): Promise<Row> => {
      // Mirror the schema defaults the real column carries — `store()` relies
      // on messageCount defaulting to 1 rather than setting it explicitly.
      const row: Row = { id: `row-${this.rows.length + 1}`, messageCount: 1, ...data };
      this.rows.push(row);
      return row;
    },
    update: async ({ where, data }: any): Promise<Row> => {
      const row = this.rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  };

  async $queryRaw(): Promise<Array<{ id: string }>> {
    return this.nearDuplicateId ? [{ id: this.nearDuplicateId }] : [];
  }
}

class SpyLlm implements LlmService {
  readonly provider = 'spy';
  calls = 0;
  available = true;

  isAvailable(): boolean {
    return this.available;
  }

  async complete(): Promise<any> {
    this.calls += 1;
    return {
      text: '',
      json: {
        kind: 'TASK',
        title: 'Checkout timeouts',
        detail: 'Something is wrong with checkout.',
        topic: 'checkout',
        importance: 0.8,
        confidence: 0.9,
      },
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      provider: 'spy',
      model: 'spy',
      latencyMs: 0,
    };
  }
}

describe('IngestService — cost gates', () => {
  let ingest: IngestService;
  let prisma: FakePrisma;
  let llm: SpyLlm;

  beforeEach(async () => {
    prisma = new FakePrisma();
    llm = new SpyLlm();

    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestService,
        { provide: PrismaService, useValue: prisma },
        { provide: LLM_SERVICE, useValue: llm },
      ],
    }).compile();

    ingest = moduleRef.get(IngestService);
  });

  const LONG_TEXT =
    'Seeing checkout timeouts again in production, the payment step hangs and then fails.';

  it('classifies a novel message exactly once', async () => {
    const { route, usedLlm } = await ingest.capture({ userId: 1, text: LONG_TEXT });

    expect(route).toBe('classified');
    expect(usedLlm).toBe(true);
    expect(llm.calls).toBe(1);
    expect(prisma.rows).toHaveLength(1);
  });

  it('merges an exact duplicate without a second call', async () => {
    await ingest.capture({ userId: 1, text: LONG_TEXT });
    const second = await ingest.capture({ userId: 1, text: LONG_TEXT });

    expect(second.route).toBe('duplicate');
    expect(second.usedLlm).toBe(false);
    // The whole point: the second forward is free.
    expect(llm.calls).toBe(1);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0].messageCount).toBe(2);
  });

  it('treats whitespace and case differences as the same message', async () => {
    await ingest.capture({ userId: 1, text: LONG_TEXT });
    const second = await ingest.capture({
      userId: 1,
      text: `  ${LONG_TEXT.toUpperCase()}  `,
    });

    expect(second.route).toBe('duplicate');
    expect(llm.calls).toBe(1);
  });

  it('keeps a duplicate from one user separate from another user', async () => {
    await ingest.capture({ userId: 1, text: LONG_TEXT });
    const other = await ingest.capture({ userId: 2, text: LONG_TEXT });

    expect(other.route).toBe('classified');
    expect(prisma.rows).toHaveLength(2);
  });

  it('handles /remember with no model call at all', async () => {
    const { item, route, usedLlm } = await ingest.capture({
      userId: 1,
      text: '/remember Check the pricing proposal when I am back',
    });

    expect(route).toBe('command');
    expect(usedLlm).toBe(false);
    expect(llm.calls).toBe(0);
    expect(item.kind).toBe('REMEMBER');
    // The command word itself must not survive into the title the user sees.
    expect(item.title).toBe('Check the pricing proposal when I am back');
  });

  it('handles the bare "remember ..." form the same way', async () => {
    const { route, item } = await ingest.capture({
      userId: 1,
      text: 'remember to renew the certificate before it expires',
    });

    expect(route).toBe('command');
    expect(llm.calls).toBe(0);
    expect(item.kind).toBe('REMEMBER');
  });

  it('skips the model for messages too short to carry meaning', async () => {
    const { route, usedLlm } = await ingest.capture({ userId: 1, text: 'ok thanks' });

    expect(route).toBe('trivial');
    expect(usedLlm).toBe(false);
    expect(llm.calls).toBe(0);
  });

  it('skips the model for a bare link', async () => {
    const { route } = await ingest.capture({ userId: 1, text: 'https://example.com/a/very/long/url' });

    expect(route).toBe('trivial');
    expect(llm.calls).toBe(0);
  });

  it('merges a near-duplicate without a second call', async () => {
    await ingest.capture({ userId: 1, text: LONG_TEXT });
    prisma.nearDuplicateId = prisma.rows[0].id;

    const second = await ingest.capture({
      userId: 1,
      text: `${LONG_TEXT} Happening again now.`,
    });

    expect(second.route).toBe('near-duplicate');
    expect(llm.calls).toBe(1);
    expect(prisma.rows).toHaveLength(1);
  });

  it('still stores the message when no model is available', async () => {
    llm.available = false;

    const { route, item, usedLlm } = await ingest.capture({ userId: 1, text: LONG_TEXT });

    // Losing the provider must never lose the user's data.
    expect(route).toBe('unclassified');
    expect(usedLlm).toBe(false);
    expect(item.sourceText).toBe(LONG_TEXT);
    expect(prisma.rows).toHaveLength(1);
  });

  it('still stores the message when the model call throws', async () => {
    jest.spyOn(llm, 'complete').mockRejectedValue(new Error('boom'));

    const { route, item } = await ingest.capture({ userId: 1, text: LONG_TEXT });

    expect(route).toBe('unclassified');
    expect(item.sourceText).toBe(LONG_TEXT);
  });
});
