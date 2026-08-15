import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { LLM_SERVICE, LlmService } from '../llm/llm.types';
import { MeteredLlmService } from '../llm/metered-llm.service';
import { SurfaceService } from '../surface/surface.service';
import { AgentService } from './agent.service';

export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;
}

export class TodayQueryDto {
  @IsOptional()
  @IsString()
  limit?: string;
}

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly surface: SurfaceService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
  ) {}

  /** The home list & grouped feed. No tokens, ever. */
  @Get('today')
  async today(@Req() req: AuthenticatedRequest, @Query() query: TodayQueryDto) {
    const uid = userId(req);
    const limit = Math.min(Math.max(Number(query.limit) || 6, 1), 20);
    const items = await this.surface.today(uid, limit);
    const feed = await this.surface.getFeed(uid);
    return { items, feed };
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
