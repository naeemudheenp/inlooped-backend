import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GoogleCalendarService } from './google-calendar.service';

@Controller('integrations/google')
export class GoogleCalendarController {
  constructor(private readonly googleService: GoogleCalendarService) {}

  @Get('install')
  install(@Query('userId') userId: string, @Res() res: Response) {
    if (!userId) {
      return res.status(400).send('userId is required');
    }
    const url = this.googleService.getOAuthUrl(Number(userId));
    return res.redirect(url);
  }

  @Get('oauth/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    try {
      const userId = this.googleService.verifyState(state);
      await this.googleService.handleCallback(code, userId);
      return res.redirect(`${frontendUrl}/settings?google=connected`);
    } catch (err: any) {
      return res.redirect(`${frontendUrl}/settings?google=error&msg=${encodeURIComponent(err.message)}`);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('settings')
  async settings(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('JWT missing userId');
    return this.googleService.getStatus(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('events')
  async events(@Req() req: AuthenticatedRequest, @Query('date') date?: string) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('JWT missing userId');
    return this.googleService.getEventsForDay(userId, date);
  }

  @UseGuards(JwtAuthGuard)
  @Get('calendars')
  async calendars(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('JWT missing userId');
    return this.googleService.listCalendars(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('select-calendar')
  async selectCalendar(@Req() req: AuthenticatedRequest, @Body('calendarId') calendarId: string) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('JWT missing userId');
    await this.googleService.selectCalendar(userId, calendarId);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('disconnect')
  async disconnect(@Req() req: AuthenticatedRequest) {
    const userId = req.user?.userId;
    if (!userId) throw new Error('JWT missing userId');
    await this.googleService.disconnect(userId);
    return { message: 'Google Calendar disconnected successfully' };
  }
}
