import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';
import { LlmModule } from './llm/llm.module';
import { IngestModule } from './ingest/ingest.module';
import { SurfaceModule } from './surface/surface.module';
import { AgentModule } from './agent/agent.module';
import { JournalModule } from './journal/journal.module';
import { SlackModule } from './integrations/slack/slack.module';
import { GoogleCalendarModule } from './integrations/google/google-calendar.module';
import { NudgesModule } from './nudges/nudges.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    UsersModule,
    LlmModule,
    IngestModule,
    SurfaceModule,
    AgentModule,
    JournalModule,
    SlackModule,
    GoogleCalendarModule,
    NudgesModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
