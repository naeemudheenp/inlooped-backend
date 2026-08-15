import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IngestService } from './ingest.service';

@Module({
  imports: [PrismaModule],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
