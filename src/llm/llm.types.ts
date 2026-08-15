/**
 * The only shape the rest of the app knows about. No controller or service
 * imports an adapter directly, so swapping providers is one env var and one
 * file — nothing above this layer changes.
 */

export type LlmTier =
  /** High volume, easy, tiny output. Every forwarded message pays this. */
  | 'cheap'
  /** Low volume, user-visible prose. Only a real question reaches this. */
  | 'strong';

export interface LlmRequest {
  /**
   * Stable across calls — this is the cacheable prefix. Never interpolate a
   * timestamp, user id, or the message itself into it: any byte change
   * invalidates the cache for every request that follows.
   */
  system: string;
  /** Volatile. Always goes after the cache breakpoint. */
  user: string;
  maxOutputTokens: number;
  tier: LlmTier;
  /** When set, the provider is constrained to emit JSON matching this schema. */
  jsonSchema?: Record<string, unknown>;
  /** Short identifier for cost logs, e.g. "classify" / "answer". */
  label: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Served from cache at ~0.1x. The number that tells you caching is working. */
  cacheReadTokens: number;
  /** Written to cache at ~1.25x. Paid once, amortised over later calls. */
  cacheWriteTokens: number;
}

export interface LlmResponse<T = unknown> {
  text: string;
  /** Parsed when `jsonSchema` was supplied and the output parsed cleanly. */
  json?: T;
  usage: LlmUsage;
  provider: string;
  model: string;
  latencyMs: number;
}

export const EMPTY_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * Thrown when no provider is configured, or the provider is down. Callers are
 * expected to catch this and degrade — an unclassified item is still stored,
 * and an unanswerable question still returns the retrieved rows. Losing the
 * model should never lose the user's data.
 */
export class LlmUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

/** Injection token — `LlmService` is an interface, so Nest needs a value. */
export const LLM_SERVICE = Symbol('LLM_SERVICE');

export interface LlmService {
  readonly provider: string;
  /** False when nothing is configured, so callers can skip work entirely. */
  isAvailable(): boolean;
  complete<T = unknown>(req: LlmRequest): Promise<LlmResponse<T>>;
}
