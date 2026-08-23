import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SlackService } from '../integrations/slack/slack.service';
import { LLM_SERVICE } from '../llm/llm.types';
import { JournalService, getLocalRangeInUtc } from './journal.service';

describe('JournalService', () => {
  let service: JournalService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        JournalService,
        { provide: PrismaService, useValue: {} },
        { provide: SlackService, useValue: {} },
        { provide: LLM_SERVICE, useValue: {} },
      ],
    }).compile();

    service = moduleRef.get<JournalService>(JournalService);
  });

  describe('getLocalRangeInUtc', () => {
    it('should calculate local range correctly for UTC', () => {
      const range = getLocalRangeInUtc('2026-08-23', 'UTC');
      expect(range.oldestSecs).toBe(Math.floor(new Date('2026-08-23T00:00:00.000Z').getTime() / 1000));
      expect(range.latestSecs).toBe(Math.floor(new Date('2026-08-23T23:59:59.000Z').getTime() / 1000));
    });

    it('should calculate local range correctly for Asia/Kolkata (+5:30)', () => {
      const range = getLocalRangeInUtc('2026-08-23', 'Asia/Kolkata');
      // Midnight in Asia/Kolkata is 18:30 of previous day UTC
      expect(range.oldestSecs).toBe(Math.floor(new Date('2026-08-22T18:30:00.000Z').getTime() / 1000));
      // End of day is 18:29:59 UTC
      expect(range.latestSecs).toBe(Math.floor(new Date('2026-08-23T18:29:59.000Z').getTime() / 1000));
    });
  });
});
