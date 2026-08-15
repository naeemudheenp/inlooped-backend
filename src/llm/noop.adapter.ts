import { Injectable } from '@nestjs/common';
import { LlmRequest, LlmResponse, LlmService, LlmUnavailableError } from './llm.types';

/**
 * Used when LLM_PROVIDER is unset. Everything except classification and
 * answering is deterministic, so with this adapter the seeded app still runs,
 * still surfaces "Things for today", still retrieves, and still journals —
 * which is what makes the UI reviewable before any key exists.
 */
@Injectable()
export class NoopAdapter implements LlmService {
  readonly provider = 'none';

  isAvailable(): boolean {
    return false;
  }

  async complete<T = unknown>(req: LlmRequest): Promise<LlmResponse<T>> {
    throw new LlmUnavailableError(
      `No LLM provider configured (${req.label}). Set LLM_PROVIDER=gemini|claude.`,
    );
  }
}
