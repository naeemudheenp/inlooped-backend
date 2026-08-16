import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
  imports: [PrismaModule],
  controllers: [GoogleCalendarController],
  providers: [GoogleCalendarService],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
