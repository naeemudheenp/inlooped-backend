import { Injectable, Logger } from '@nestjs/common';
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
 * Raw REST, no SDK — carried over from the proven `callGemini` in opennotepad
 * (timeout, abort, and 429/5xx handling were already correct there).
 *
 * Both tiers point at Flash today: it is already the cheapest thing available,
 * and the answer step is not intelligence-sensitive. The split exists so the
 * strong tier can be raised to Pro without touching a call site.
 */
const TIER_MODELS: Record<LlmTier, string> = {
  cheap: 'gemini-3-flash-preview',
  strong: 'gemini-3-flash-preview',
};

const TIMEOUT_MS = 30_000;

@Injectable()
export class GeminiAdapter implements LlmService {
  readonly provider = 'gemini';
  private readonly logger = new Logger(GeminiAdapter.name);

  isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async complete<T = unknown>(req: LlmRequest): Promise<LlmResponse<T>> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new LlmUnavailableError('GEMINI_API_KEY is not configured');
    }

    const model = TIER_MODELS[req.tier];
    const started = Date.now();

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: req.maxOutputTokens,
      temperature: 0.1,
    };
    if (req.jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      // Gemini accepts an OpenAPI-flavoured subset of JSON Schema. Our schemas
      // stay within it (object / string / number / enum), so they pass through.
      generationConfig.responseSchema = stripUnsupported(req.jsonSchema);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: 'user', parts: [{ text: req.user }] }],
            generationConfig,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new LlmUnavailableError(
          `Gemini ${response.status} (${req.label})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        );
      }

      const data = await response.json();
      const text: string = (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();

      return {
        text,
        json: req.jsonSchema ? safeParse<T>(text) : undefined,
        usage: readUsage(data.usageMetadata),
        provider: this.provider,
        model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof LlmUnavailableError) throw err;
      if ((err as Error)?.name === 'AbortError') {
        throw new LlmUnavailableError(`Gemini timed out after ${TIMEOUT_MS}ms (${req.label})`);
      }
      throw new LlmUnavailableError(`Gemini request failed (${req.label})`, err);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function readUsage(meta: Record<string, number> | undefined): LlmUsage {
  if (!meta) return { ...EMPTY_USAGE };
  return {
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: meta.candidatesTokenCount ?? 0,
    cacheReadTokens: meta.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
  };
}

/** Gemini rejects a few JSON Schema keywords outright; drop them rather than 400. */
function stripUnsupported(schema: Record<string, unknown>): Record<string, unknown> {
  const { additionalProperties, $schema, ...rest } = schema as Record<string, unknown>;
  if (rest.properties && typeof rest.properties === 'object') {
    const props = rest.properties as Record<string, Record<string, unknown>>;
    rest.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, stripUnsupported(v)]),
    );
  }
  return rest;
}

function safeParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
