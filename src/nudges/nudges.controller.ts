import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NUDGE_MAX_DAYS, NUDGE_MIN_DAYS, WaitingNudgeService } from './waiting-nudge.service';

export class UpdateNudgeSettingsDto {
  @IsOptional()
  @IsBoolean()
  viaSlack?: boolean;

  @IsOptional()
  @IsBoolean()
  viaTeams?: boolean;

  @IsOptional()
  @IsInt()
  @Min(NUDGE_MIN_DAYS)
  @Max(NUDGE_MAX_DAYS)
  days?: number;
}

@Controller('nudges')
@UseGuards(JwtAuthGuard)
export class NudgesController {
  constructor(private readonly nudges: WaitingNudgeService) {}

  @Get('settings')
  settings(@Req() req: AuthenticatedRequest) {
    return this.nudges.getSettings(userId(req));
  }

  @Patch('settings')
  updateSettings(@Req() req: AuthenticatedRequest, @Body() body: UpdateNudgeSettingsDto) {
    return this.nudges.updateSettings(userId(req), body);
  }
}

function userId(req: AuthenticatedRequest): number {
  const id = req.user?.userId;
  if (!id) throw new Error('JWT is missing userId');
  return id;
}
