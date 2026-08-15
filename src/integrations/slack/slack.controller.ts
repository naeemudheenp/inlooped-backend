import {
  Controller,
  Get,
  Post,
  Patch,
  Query,
  Res,
  Req,
  Body,
  Headers,
  UnauthorizedException,
  UseGuards,
  RawBodyRequest,
} from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackEventsService } from './slack-events.service';
import { Request, Response } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtAuthGuard, AuthenticatedRequest } from 'src/common/guards/jwt-auth.guard';
import { verifySlackSignature } from './slack-signature.util';

@Controller('integrations/slack')
export class SlackController {
  constructor(
    private readonly slackService: SlackService,
    private readonly slackEvents: SlackEventsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('install')
  async install(@Query('userId') userId: string, @Res() res: Response) {
    const url = this.slackService.getSlackOAuthUrl(Number(userId));
    return res.redirect(url);
  }

  @Get('oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const userId = this.slackService.verifyInstallState(state);
    await this.slackService.handleOAuthCallback(code, userId);
    return res.redirect(`${process.env.FRONTEND_URL}/settings?slack=connected`);
  }

  @Post('disconnect')
  async disconnect(@Body('userId') userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: Number(userId) },
    });
    if (!user) {
      return { message: 'User not found', code: 404 };
    }
    if (!user.slackEnabled) {
      return { message: 'User ID is required', code: 400 };
    }
    await this.slackService.disconnect(userId);
    return { message: 'Slack disconnected successfully', code: 200 };
  }

  @Get('test')
  async sendTestMessage(@Query('userId') userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: Number(userId) },
    });
    if (!user) {
      return { error: 'User not found' };
    }
    return this.slackService.sendSlackMessage(
      user.slackAccessToken,
      user.slackUserId,
      'test message',
    );
  }

  // ---- Inbound: Slack Events API (message.im, reaction_added) ----
  @Post('events')
  async events(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-slack-signature') signature: string,
    @Headers('x-slack-request-timestamp') timestamp: string,
  ) {
    // Slack's one-time endpoint verification handshake.
    if (body?.type === 'url_verification') {
      return { challenge: body.challenge };
    }

    if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET, req.rawBody, timestamp, signature)) {
      throw new UnauthorizedException('Invalid Slack signature');
    }

    // Ack within Slack's 3s window; do the actual work asynchronously.
    if (body?.type === 'event_callback') {
      void this.slackEvents.handleEvent(body.event, body.team_id);
    }
    return { ok: true };
  }

  // ---- Inbound: Interactivity (message shortcut "Save to OpenNotepad") ----
  @Post('interactivity')
  async interactivity(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-slack-signature') signature: string,
    @Headers('x-slack-request-timestamp') timestamp: string,
  ) {
    if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET, req.rawBody, timestamp, signature)) {
      throw new UnauthorizedException('Invalid Slack signature');
    }

    let payload: any;
    try {
      payload = JSON.parse(body?.payload ?? '{}');
    } catch {
      payload = {};
    }

    if (payload.type === 'message_action') {
      void this.slackEvents.handleShortcut(payload);
    }
    return {};
  }

  // ---- Inbound: slash commands (/remember) ----
  // Slack posts these as form-encoded, and requires a reply inside 3s. We ack
  // immediately and capture asynchronously, same pattern as /events above.
  @Post('commands')
  async commands(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-slack-signature') signature: string,
    @Headers('x-slack-request-timestamp') timestamp: string,
  ) {
    if (!verifySlackSignature(process.env.SLACK_SIGNING_SECRET, req.rawBody, timestamp, signature)) {
      throw new UnauthorizedException('Invalid Slack signature');
    }

    if ((body?.command ?? '').replace('/', '') !== 'remember') {
      return { response_type: 'ephemeral', text: 'Unknown command.' };
    }
    if (!body?.text?.trim()) {
      return { response_type: 'ephemeral', text: 'Usage: `/remember check the pricing proposal`' };
    }

    void this.slackEvents.handleRememberCommand(body);
    return { response_type: 'ephemeral', text: "Got it — I'll bring that back." };
  }

  // ---- Connection status (Settings screen) ----
  @Get('settings')
  @UseGuards(JwtAuthGuard)
  async getSettings(@Req() req: AuthenticatedRequest) {
    const user = await this.prisma.users.findUnique({
      where: { id: req.user.userId },
      select: { slackEnabled: true, slackTimezone: true },
    });
    return user ?? { error: 'User not found' };
  }

  @Patch('settings')
  @UseGuards(JwtAuthGuard)
  async updateSettings(@Req() req: AuthenticatedRequest, @Body() body: any) {
    const data: { slackTimezone?: string } = {};
    if (typeof body?.slackTimezone === 'string' && body.slackTimezone.length) {
      data.slackTimezone = body.slackTimezone;
    }
    await this.prisma.users.update({ where: { id: req.user.userId }, data });
    return { ok: true, ...data };
  }
}
