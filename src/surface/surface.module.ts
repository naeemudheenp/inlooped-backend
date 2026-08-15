import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SurfaceService } from './surface.service';

@Module({
  imports: [PrismaModule],
  providers: [SurfaceService],
  exports: [SurfaceService],
})
export class SurfaceModule {}
