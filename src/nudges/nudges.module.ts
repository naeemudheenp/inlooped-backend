import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SlackModule } from '../integrations/slack/slack.module';
import { TeamsModule } from '../integrations/teams/teams.module';
import { NudgesController } from './nudges.controller';
import { WaitingNudgeService } from './waiting-nudge.service';

@Module({
  imports: [PrismaModule, SlackModule, TeamsModule],
  controllers: [NudgesController],
  providers: [WaitingNudgeService],
  exports: [WaitingNudgeService],
})
export class NudgesModule {}
