import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LLM_SERVICE, LlmService } from '../llm/llm.types';
import { MeteredLlmService } from '../llm/metered-llm.service';
import { SurfaceService } from '../surface/surface.service';
import { SNOOZE_PRESETS, SnoozePreset, listSnoozePresets } from '../surface/snooze-presets';
import { AgentService } from './agent.service';
import { IngestService } from '../ingest/ingest.service';
import { GoogleCalendarService } from '../integrations/google/google-calendar.service';

export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;
}

export class CaptureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsString()
  date?: string;
}

export class TodayQueryDto {
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  date?: string;
}

/** Exactly one of `until` (an exact instant) or `preset` is required. */
export class SnoozeDto {
  @IsOptional()
  @IsDateString()
  until?: string;

  @IsOptional()
  @IsIn(SNOOZE_PRESETS as unknown as string[])
  preset?: SnoozePreset;

  /** IANA zone the preset is resolved in (e.g. the browser's). Defaults to the user's. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class SnoozePresetsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly surface: SurfaceService,
    private readonly ingest: IngestService,
    private readonly googleCalendar: GoogleCalendarService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
  ) {}


  /** The home list & grouped feed. Merges Google Calendar events for target date. */
  @Get('today')
  async today(@Req() req: AuthenticatedRequest, @Query() query: TodayQueryDto) {
    const uid = userId(req);
    const limit = Math.min(Math.max(Number(query.limit) || 6, 1), 20);
    const items = await this.surface.today(uid, limit, query.date);
    const feed = await this.surface.getFeed(uid, query.date);

    // Fetch Google Calendar events for the requested date (or today)
    const calEvents = await this.googleCalendar.getEventsForDay(uid, query.date).catch(() => []);
    const calendarWorkItems = calEvents.map((evt) => ({
      id: `gcal-${evt.id}`,
      title: evt.title,
      detail: evt.description || (evt.location ? `Location: ${evt.location}` : null),
      meta: evt.isAllDay ? 'All Day' : 'Google Calendar',
      kind: 'EVENT',
      status: 'OPEN',
      sourceUrl: evt.hangoutLink || evt.htmlLink || null,
      sourceApp: 'google_calendar',
      sourceChannel: null,
      personName: null,
      messageCount: 1,
      isPinned: false,
      occurredAt: evt.startTime,
      snoozedUntil: null,
    }));

    // Merge calendar events into today feed items
    const mergedToday = [...calendarWorkItems, ...feed.today];
    const mergedItems = [...calendarWorkItems, ...items];

    return {
      items: mergedItems,
      feed: {
        pinned: feed.pinned,
        today: mergedToday,
        recent: feed.recent,
      },
    };
  }

  @Post('capture')
  async capture(@Req() req: AuthenticatedRequest, @Body() body: CaptureDto) {
    const occurredAt = body.date ? new Date(body.date) : undefined;
    const outcome = await this.ingest.capture({
      userId: userId(req),
      text: body.text,
      sourceApp: 'user', // Better label for direct notes
      occurredAt,
    });
    return {
      ok: true,
      item: this.surface.present(outcome.item),
      route: outcome.route,
      usedLlm: outcome.usedLlm,
    };
  }

  @Post('ask')
  async ask(@Req() req: AuthenticatedRequest, @Body() body: AskDto) {
    return this.agent.ask(userId(req), body.question);
  }

  @Post('items/:id/pin')
  async togglePin(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const isPinned = await this.surface.togglePin(userId(req), id);
    return { ok: true, isPinned };
  }

  @Post('items/:id/resolve')
  async resolve(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.surface.resolve(userId(req), id);
    return { ok: true };
  }

  @Post('items/:id/dismiss')
  async dismiss(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    await this.surface.dismiss(userId(req), id);
    return { ok: true };
  }

  @Post('items/:id/snooze')
  async snooze(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: SnoozeDto,
  ) {
    if (Boolean(body.until) === Boolean(body.preset)) {
      throw new BadRequestException('Send either "until" or "preset"');
    }
    const uid = userId(req);
    const snoozedUntil = body.preset
      ? await this.surface.snoozeToPreset(uid, id, body.preset, body.timezone)
      : await this.surface.snooze(uid, id, new Date(body.until!));
    return { ok: true, snoozedUntil };
  }

  /** Bring a snoozed item back now. */
  @Post('items/:id/unsnooze')
  async unsnooze(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const item = await this.surface.unsnooze(userId(req), id);
    return { ok: true, item };
  }

  /** Everything currently snoozed, soonest to return first. */
  @Get('snoozed')
  async snoozed(@Req() req: AuthenticatedRequest) {
    const items = await this.surface.listSnoozed(userId(req));
    return { items };
  }

  /** The snooze menu: each preset's exact time in the user's zone, and whether it's still reachable. */
  @Get('snooze-presets')
  async snoozePresets(@Req() req: AuthenticatedRequest, @Query() query: SnoozePresetsQueryDto) {
    const timezone = await this.surface.resolveTimezone(userId(req), query.timezone);
    return { timezone, presets: listSnoozePresets(new Date(), timezone) };
  }

  /**
   * Token spend since boot, per call site. Makes the cost model something you
   * can read off the running system rather than take on trust.
   */
  @Get('usage')
  usage() {
    const metered = this.llm as MeteredLlmService;
    return {
      provider: this.llm.provider,
      available: this.llm.isAvailable(),
      byLabel: typeof metered.snapshot === 'function' ? metered.snapshot() : {},
    };
  }
}

function userId(req: AuthenticatedRequest): number {
  const id = req.user?.userId;
  if (!id) throw new Error('JWT is missing userId');
  return id;
}
