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
  cheap: 'gemini-3.6-flash',
  strong: 'gemini-3.6-flash',
};

const TIMEOUT_MS = 120_000;

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
      maxOutputTokens: Math.max(req.maxOutputTokens ?? 0, 4096),
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
      // The model may return multiple parts (including thoughts); filter out thought parts
      // to extract the actual text response.
      const parts: Array<{ text?: string; thought?: boolean }> =
        data.candidates?.[0]?.content?.parts ?? [];
      const textParts = parts.filter((p) => p.text && !p.thought);
      const text: string = (
        textParts.length > 0
          ? textParts.map((p) => p.text).join('\n\n')
          : (parts.filter((p) => p.text).pop()?.text ?? '')
      ).trim();

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
    // Thinking models may truncate JSON output. Try to salvage what we can.
    return lenientParse<T>(text);
  }
}

/**
 * Attempt to extract top-level string/array values from truncated JSON.
 * Specifically designed to rescue `journalMarkdown` when the full JSON is
 * cut off mid-way through `workItems`.
 */
function lenientParse<T>(text: string): T | undefined {
  if (!text || !text.startsWith('{')) return undefined;

  const result: Record<string, unknown> = {};

  // Extract journalMarkdown — a top-level string value
  const mdMatch = text.match(/"journalMarkdown"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (mdMatch) {
    result.journalMarkdown = mdMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  // Try to extract complete workItems array objects
  const itemsMatch = text.match(/"workItems"\s*:\s*\[/);
  if (itemsMatch) {
    const startIdx = (itemsMatch.index ?? 0) + itemsMatch[0].length;
    const items: unknown[] = [];
    // Find each complete {...} object
    let depth = 0;
    let objStart = -1;
    for (let i = startIdx; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) objStart = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          try {
            items.push(JSON.parse(text.slice(objStart, i + 1)));
          } catch { /* skip incomplete objects */ }
          objStart = -1;
        }
      }
    }
    result.workItems = items;
  }

  return Object.keys(result).length > 0 ? (result as T) : undefined;
}
