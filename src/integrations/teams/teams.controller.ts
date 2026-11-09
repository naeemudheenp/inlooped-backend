import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import { TeamsService } from './teams.service';

@Controller('integrations/teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('install')
  @UseGuards(JwtAuthGuard)
  install(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const userId = req.user?.userId;
    if (!userId) throw new BadRequestException('JWT missing userId');
    return res.redirect(this.teams.getOAuthUrl(userId));
  }

  @Get('oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    if (error) {
      return res.redirect(
        `${frontendUrl}/settings?teams=error&msg=${encodeURIComponent(errorDescription || error)}`,
      );
    }

    try {
      if (!code || !state)
        throw new BadRequestException('Missing Microsoft OAuth code or state');
      const userId = this.teams.verifyState(state);
      await this.teams.handleOAuthCallback(code, userId);
      return res.redirect(`${frontendUrl}/settings?teams=connected`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Teams connection failed';
      return res.redirect(
        `${frontendUrl}/settings?teams=error&msg=${encodeURIComponent(message)}`,
      );
    }
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  settings(@Req() req: AuthenticatedRequest) {
    return this.teams.getSettings(this.userId(req));
  }

  @Patch('settings')
  @UseGuards(JwtAuthGuard)
  updateSettings(@Req() req: AuthenticatedRequest, @Body() body: any) {
    return this.teams.updateSettings(this.userId(req), {
      newCaptureNotifications: body?.newCaptureNotifications,
      weeklyRecapEnabled: body?.weeklyRecapEnabled,
      timezone: body?.timezone,
    });
  }

  @Get('teams')
  @UseGuards(JwtAuthGuard)
  listTeams(@Req() req: AuthenticatedRequest) {
    return this.teams.listTeams(this.userId(req));
  }

  @Get('channels')
  @UseGuards(JwtAuthGuard)
  listChannels(
    @Req() req: AuthenticatedRequest,
    @Query('teamId') teamId: string,
  ) {
    if (!teamId) throw new BadRequestException('teamId is required');
    return this.teams.listChannels(this.userId(req), teamId);
  }

  @Post('channel')
  @UseGuards(JwtAuthGuard)
  async selectChannel(
    @Req() req: AuthenticatedRequest,
    @Body() body: { teamId?: string; channelId?: string },
  ) {
    await this.teams.selectChannel(
      this.userId(req),
      body?.teamId ?? '',
      body?.channelId ?? '',
    );
    return { ok: true };
  }

  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@Req() req: AuthenticatedRequest) {
    await this.teams.disconnect(this.userId(req));
    return { ok: true };
  }

  private userId(req: AuthenticatedRequest): number {
    const userId = req.user?.userId;
    if (!userId) throw new BadRequestException('JWT missing userId');
    return userId;
  }
}
