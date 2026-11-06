import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TeamsModule } from '../integrations/teams/teams.module';
import { IngestService } from './ingest.service';

@Module({
  imports: [PrismaModule, TeamsModule],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
