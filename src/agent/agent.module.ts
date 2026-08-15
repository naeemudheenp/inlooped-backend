import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SurfaceModule } from '../surface/surface.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  imports: [PrismaModule, SurfaceModule],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
