import { Module } from '@nestjs/common';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';
import { SlackEventsService } from './slack-events.service';
import { SlackSocketService } from './slack-socket.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersModule } from '../../users/users.module';
import { IngestModule } from '../../ingest/ingest.module';

@Module({
  imports: [PrismaModule, UsersModule, IngestModule],
  controllers: [SlackController],
  providers: [SlackService, SlackEventsService, SlackSocketService],
  exports: [SlackService],
})
export class SlackModule {}
