import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JournalService } from './journal.service';
import { SlackService } from '../integrations/slack/slack.service';
import { PrismaService } from '../prisma/prisma.service';

export class SaveEntryDto {
  @IsString()
  @MaxLength(50_000)
  body!: string;
}

export class ListQueryDto {
  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller('journal')
@UseGuards(JwtAuthGuard)
export class JournalController {
  constructor(
    private readonly journal: JournalService,
    private readonly slackService: SlackService,
    private readonly prisma: PrismaService,
  ) {}

  /** Previous entries, newest first — the list under the writing area. */
  @Get('entries')
  async list(@Req() req: AuthenticatedRequest, @Query() query: ListQueryDto) {
    const entries = await this.journal.list(userId(req), Number(query.limit) || 30);
    return { entries };
  }

  @Get(':day')
  async get(@Req() req: AuthenticatedRequest, @Param('day') day: string) {
    const entry = await this.journal.get(userId(req), day);
    return { entry };
  }

  @Put(':day')
  async save(
    @Req() req: AuthenticatedRequest,
    @Param('day') day: string,
    @Body() body: SaveEntryDto,
  ) {
    const entry = await this.journal.upsert(userId(req), day, body.body);
    return { entry };
  }

  @Post(':day/send-slack')
  async sendToSlack(@Req() req: AuthenticatedRequest, @Param('day') day: string) {
    const uid = userId(req);
    const entry = await this.journal.get(uid, day);
    if (!entry || !entry.body) {
      return { ok: false, message: 'No journal entry found for this day.' };
    }

    const user = await this.prisma.users.findUnique({ where: { id: uid } });
    if (!user || !user.slackEnabled || !user.slackAccessToken || !user.slackUserId) {
      return { ok: false, message: 'Slack is not connected. Connect Slack in Settings first.' };
    }

    const formattedText = `📖 *Journal Entry for ${day}*\n\n${entry.body}`;
    await this.slackService.sendBotMessage(user.slackAccessToken, user.slackUserId, formattedText);
    return { ok: true, message: 'Journal entry sent to your Slack DM successfully!' };
  }
}

function userId(req: AuthenticatedRequest): number {
  const id = req.user?.userId;
  if (!id) throw new Error('JWT is missing userId');
  return id;
}
