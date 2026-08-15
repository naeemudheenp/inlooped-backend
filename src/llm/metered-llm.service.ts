import { Logger } from '@nestjs/common';
import { LlmRequest, LlmResponse, LlmService } from './llm.types';

export interface Tally {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Wraps whichever adapter is active and records what every call cost. The cost
 * model in the plan claims ~20 calls/day/user and a working prompt cache;
 * without this the claim is an assumption rather than a measurement.
 *
 * `GET /agent/usage` reads these counters, so the numbers are inspectable
 * rather than buried in logs.
 */
export class MeteredLlmService implements LlmService {
  private readonly logger = new Logger('LLM');
  private readonly tallies = new Map<string, Tally>();

  constructor(private readonly inner: LlmService) {}

  get provider(): string {
    return this.inner.provider;
  }

  isAvailable(): boolean {
    return this.inner.isAvailable();
  }

  async complete<T = unknown>(req: LlmRequest): Promise<LlmResponse<T>> {
    const res = await this.inner.complete<T>(req);
    const t = this.tally(req.label);

    t.calls += 1;
    t.inputTokens += res.usage.inputTokens;
    t.outputTokens += res.usage.outputTokens;
    t.cacheReadTokens += res.usage.cacheReadTokens;
    t.cacheWriteTokens += res.usage.cacheWriteTokens;

    this.logger.debug(
      `${req.label} · ${res.provider}/${res.model} · in ${res.usage.inputTokens} ` +
        `out ${res.usage.outputTokens} cacheRead ${res.usage.cacheReadTokens} ` +
        `cacheWrite ${res.usage.cacheWriteTokens} · ${res.latencyMs}ms`,
    );

    return res;
  }

  /** Per-label totals since boot. */
  snapshot(): Record<string, Tally> {
    return Object.fromEntries(this.tallies.entries());
  }

  private tally(label: string): Tally {
    let t = this.tallies.get(label);
    if (!t) {
      t = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
      this.tallies.set(label, t);
    }
    return t;
  }
}
