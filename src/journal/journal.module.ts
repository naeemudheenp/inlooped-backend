import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SlackModule } from '../integrations/slack/slack.module';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

@Module({
  imports: [PrismaModule, SlackModule],
  controllers: [JournalController],
  providers: [JournalService],
  exports: [JournalService],
})
export class JournalModule {}
