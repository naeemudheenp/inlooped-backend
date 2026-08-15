import { Global, Logger, Module } from '@nestjs/common';
import { ClaudeAdapter } from './claude.adapter';
import { GeminiAdapter } from './gemini.adapter';
import { NoopAdapter } from './noop.adapter';
import { MeteredLlmService } from './metered-llm.service';
import { LLM_SERVICE, LlmService } from './llm.types';

/**
 * One place decides the provider. Everything downstream injects LLM_SERVICE and
 * never learns which one it got.
 */
@Global()
@Module({
  providers: [
    ClaudeAdapter,
    GeminiAdapter,
    NoopAdapter,
    {
      provide: LLM_SERVICE,
      inject: [ClaudeAdapter, GeminiAdapter, NoopAdapter],
      useFactory: (
        claude: ClaudeAdapter,
        gemini: GeminiAdapter,
        noop: NoopAdapter,
      ): LlmService => {
        const logger = new Logger('LlmModule');
        const configured = (process.env.LLM_PROVIDER ?? '').trim().toLowerCase();

        let chosen: LlmService;
        switch (configured) {
          case 'claude':
            chosen = claude;
            break;
          case 'gemini':
            chosen = gemini;
            break;
          case '':
            chosen = noop;
            break;
          default:
            logger.warn(`Unknown LLM_PROVIDER "${configured}" — falling back to none.`);
            chosen = noop;
        }

        if (chosen !== noop && !chosen.isAvailable()) {
          logger.warn(
            `LLM_PROVIDER=${configured} but its API key is missing — running deterministic-only.`,
          );
          chosen = noop;
        }

        logger.log(
          chosen === noop
            ? 'No LLM provider configured — ingest stores raw, agent answers from retrieval only.'
            : `LLM provider: ${chosen.provider}`,
        );

        return new MeteredLlmService(chosen);
      },
    },
  ],
  exports: [LLM_SERVICE],
})
export class LlmModule {}
