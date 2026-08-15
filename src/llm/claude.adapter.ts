import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  EMPTY_USAGE,
  LlmRequest,
  LlmResponse,
  LlmService,
  LlmTier,
  LlmUnavailableError,
  LlmUsage,
} from './llm.types';

/**
 * Per-tier model config. The two tiers differ in more than the model string —
 * Haiku rejects `effort` outright, and its minimum cacheable prefix is four
 * times Sonnet's — so the differences live here rather than in call sites.
 */
interface TierConfig {
  model: string;
  /** Haiku 4.5 returns 400 if `effort` is present. Sonnet 5 accepts it. */
  supportsEffort: boolean;
  /**
   * Minimum prefix that will cache, in tokens. Below this the API silently
   * declines to cache — no error, `cache_creation_input_tokens` just stays 0.
   * Haiku 4.5 is 4096; Sonnet 5 is 1024.
   */
  cacheMinTokens: number;
}

const TIERS: Record<LlmTier, TierConfig> = {
  cheap: { model: 'claude-haiku-4-5', supportsEffort: false, cacheMinTokens: 4096 },
  strong: { model: 'claude-sonnet-5', supportsEffort: true, cacheMinTokens: 1024 },
};

const TIMEOUT_MS = 30_000;

@Injectable()
export class ClaudeAdapter implements LlmService {
  readonly provider = 'claude';
  private readonly logger = new Logger(ClaudeAdapter.name);
  private readonly client?: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 2 });
    }
  }

  isAvailable(): boolean {
    return Boolean(this.client);
  }

  async complete<T = unknown>(req: LlmRequest): Promise<LlmResponse<T>> {
    if (!this.client) {
      throw new LlmUnavailableError('ANTHROPIC_API_KEY is not configured');
    }

    const tier = TIERS[req.tier];
    const started = Date.now();

    // The system prompt is the cacheable prefix; the message is deliberately
    // the only thing after the breakpoint.
    const params: Record<string, unknown> = {
      model: tier.model,
      max_tokens: req.maxOutputTokens,
      system: [
        {
          type: 'text',
          text: req.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: req.user }],
    };

    const outputConfig: Record<string, unknown> = {};
    if (req.jsonSchema) {
      outputConfig.format = { type: 'json_schema', schema: req.jsonSchema };
    }
    if (tier.supportsEffort) {
      // Nothing here is intelligence-sensitive: classification is a lookup and
      // answering is a rewrite of eight rows we already retrieved.
      outputConfig.effort = 'low';
      params.thinking = { type: 'disabled' };
    }
    if (Object.keys(outputConfig).length > 0) {
      params.output_config = outputConfig;
    }

    let message: Anthropic.Message;
    try {
      message = (await this.client.messages.create(params as never)) as Anthropic.Message;
    } catch (err) {
      throw new LlmUnavailableError(`Claude request failed (${req.label})`, err);
    }

    // A safety decline is a 200 with an empty content array — reading
    // content[0] without this check throws on exactly the requests that matter.
    if (message.stop_reason === 'refusal') {
      throw new LlmUnavailableError(`Claude declined the request (${req.label})`);
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const usage = readUsage(message.usage);
    this.warnIfPrefixTooShortToCache(req, tier, usage);

    return {
      text,
      json: req.jsonSchema ? safeParse<T>(text) : undefined,
      usage,
      provider: this.provider,
      model: tier.model,
      latencyMs: Date.now() - started,
    };
  }

  /**
   * Caching failing is silent by design in the API, so make it loud here —
   * otherwise the cost model quietly stops holding and nothing surfaces it.
   */
  private warnIfPrefixTooShortToCache(req: LlmRequest, tier: TierConfig, usage: LlmUsage): void {
    if (usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0) return;
    const approxPrefixTokens = req.system.length / 4;
    if (approxPrefixTokens < tier.cacheMinTokens) {
      this.logger.warn(
        `[${req.label}] system prompt is ~${Math.round(approxPrefixTokens)} tokens, below the ` +
          `${tier.cacheMinTokens}-token minimum for ${tier.model} — it will never cache. ` +
          `Either pad the prompt past the minimum or accept the uncached cost.`,
      );
    }
  }
}

function readUsage(usage: Anthropic.Usage | undefined): LlmUsage {
  if (!usage) return { ...EMPTY_USAGE };
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function safeParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
