import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SurfaceModule } from '../../surface/surface.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamsDigestService } from './teams-digest.service';

@Module({
  imports: [PrismaModule, SurfaceModule],
  controllers: [TeamsController],
  providers: [TeamsService, TeamsDigestService],
  exports: [TeamsService],
})
export class TeamsModule {}
