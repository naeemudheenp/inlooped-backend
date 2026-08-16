import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SurfaceModule } from '../surface/surface.module';
import { GoogleCalendarModule } from '../integrations/google/google-calendar.module';
import { IngestModule } from '../ingest/ingest.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [PrismaModule, SurfaceModule, GoogleCalendarModule, IngestModule],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}

