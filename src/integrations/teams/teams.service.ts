import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';
import {
  formatTeamsCapture,
  formatTeamsWeeklyRecap,
  isTeamsRecapDue,
  TeamsWeeklyRecap,
} from './teams-recap.format';

const GRAPH_URL = 'https://graph.microsoft.com/v1.0';
const TOKEN_REFRESH_MARGIN_MS = 120_000;
const RECAP_GAP_MS = 6 * 86_400_000;
const GRAPH_SCOPES = [
  'openid',
  'profile',
  'offline_access',
  'User.Read',
  'Team.ReadBasic.All',
  'Channel.ReadBasic.All',
  'ChannelMessage.Send',
].join(' ');

type GraphTeam = { id: string; displayName: string; description?: string };
type GraphChannel = { id: string; displayName: string; membershipType?: string };
type MicrosoftTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: string | number;
  error_description?: string;
};

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(private readonly prisma: PrismaService) {}

  getOAuthUrl(userId: number): string {
    const state = jwt.sign({ userId, purpose: 'teams-install' }, this.jwtSecret(), {
      expiresIn: '10m',
    });
    const params = new URLSearchParams({
      client_id: this.clientId(),
      response_type: 'code',
      redirect_uri: this.redirectUri(),
      response_mode: 'query',
      scope: GRAPH_SCOPES,
      state,
    });
    return `${this.authority()}/oauth2/v2.0/authorize?${params}`;
  }

  verifyState(state: string): number {
    try {
      const payload = jwt.verify(state, this.jwtSecret()) as {
        userId?: number;
        purpose?: string;
      };
      if (payload.purpose !== 'teams-install' || !payload.userId) {
        throw new Error('Invalid Teams OAuth state');
      }
      return payload.userId;
    } catch {
      throw new UnauthorizedException('Invalid or expired Teams connection link');
    }
  }

  async handleOAuthCallback(code: string, userId: number): Promise<void> {
    const response = await fetch(`${this.authority()}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri(),
        scope: GRAPH_SCOPES,
      }),
    });
    const tokens = await this.parseTokenResponse(response);
    if (!tokens.refresh_token) {
      throw new Error('Microsoft did not return a refresh token; verify offline_access consent');
    }

    const profile = await this.fetchProfile(tokens.access_token);
    await this.prisma.users.update({
      where: { id: userId },
      data: {
        teamsAccessToken: tokens.access_token,
        teamsRefreshToken: tokens.refresh_token,
        teamsAccessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1000),
        teamsUserId: profile.id,
        teamsUserEmail: profile.mail ?? profile.userPrincipalName ?? null,
        teamsEnabled: true,
        teamsTeamId: null,
        teamsChannelId: null,
      },
    });
  }

  async getSettings(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        teamsEnabled: true,
        teamsUserEmail: true,
        teamsTeamId: true,
        teamsChannelId: true,
        teamsNewCaptureNotifications: true,
        teamsWeeklyRecapEnabled: true,
        teamsTimezone: true,
      },
    });
    if (!user) return { error: 'User not found' };
    return { ...user, channelSelected: Boolean(user.teamsTeamId && user.teamsChannelId) };
  }

  async updateSettings(
    userId: number,
    settings: { newCaptureNotifications?: boolean; weeklyRecapEnabled?: boolean; timezone?: string },
  ) {
    const data: {
      teamsNewCaptureNotifications?: boolean;
      teamsWeeklyRecapEnabled?: boolean;
      teamsTimezone?: string;
    } = {};
    if (typeof settings.newCaptureNotifications === 'boolean') {
      data.teamsNewCaptureNotifications = settings.newCaptureNotifications;
    }
    if (typeof settings.weeklyRecapEnabled === 'boolean') {
      data.teamsWeeklyRecapEnabled = settings.weeklyRecapEnabled;
    }
    if (typeof settings.timezone === 'string' && settings.timezone.trim()) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: settings.timezone.trim() });
      } catch {
        throw new BadRequestException('Invalid timezone');
      }
      data.teamsTimezone = settings.timezone.trim();
    }
    await this.prisma.users.update({ where: { id: userId }, data });
    return { ok: true, ...settings };
  }

  async listTeams(userId: number): Promise<GraphTeam[]> {
    return this.graphCollection<GraphTeam>(userId, '/me/joinedTeams?$select=id,displayName,description');
  }

  async listChannels(userId: number, teamId: string): Promise<GraphChannel[]> {
    await this.assertJoinedTeam(userId, teamId);
    return this.graphCollection<GraphChannel>(
      userId,
      `/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName,membershipType`,
    );
  }

  async selectChannel(userId: number, teamId: string, channelId: string): Promise<void> {
    if (!teamId?.trim() || !channelId?.trim()) {
      throw new BadRequestException('A team ID and channel ID are required');
    }
    const channels = await this.listChannels(userId, teamId);
    if (!channels.some((channel) => channel.id === channelId)) {
      throw new BadRequestException('The selected channel is not available in that team');
    }
    await this.prisma.users.update({
      where: { id: userId },
      data: { teamsTeamId: teamId, teamsChannelId: channelId },
    });
  }

  async disconnect(userId: number): Promise<void> {
    await this.prisma.users.update({
      where: { id: userId },
      data: {
        teamsAccessToken: null,
        teamsRefreshToken: null,
        teamsAccessTokenExpiresAt: null,
        teamsUserId: null,
        teamsUserEmail: null,
        teamsEnabled: false,
        teamsTeamId: null,
        teamsChannelId: null,
      },
    });
  }

  async notifyCapture(
    userId: number,
    item: { id: string; title: string; kind: string },
  ): Promise<void> {
    try {
      const user = await this.prisma.users.findUnique({
        where: { id: userId },
        select: {
          teamsEnabled: true,
          teamsNewCaptureNotifications: true,
          teamsTeamId: true,
          teamsChannelId: true,
        },
      });
      if (
        !user?.teamsEnabled ||
        !user.teamsNewCaptureNotifications ||
        !user.teamsTeamId ||
        !user.teamsChannelId
      ) {
        return;
      }
      await this.sendMessage(userId, formatTeamsCapture(item, process.env.FRONTEND_URL));
    } catch (err) {
      this.logger.error(`Teams capture notification failed for user ${userId}`, err as Error);
    }
  }

  @Cron('*/15 * * * *')
  async tick(now: Date = new Date()): Promise<number> {
    const users = await this.prisma.users.findMany({
      where: {
        teamsEnabled: true,
        teamsWeeklyRecapEnabled: true,
        teamsAccessToken: { not: null },
        teamsRefreshToken: { not: null },
        teamsTeamId: { not: null },
        teamsChannelId: { not: null },
      },
      select: { id: true, teamsTimezone: true },
    });

    let sent = 0;
    for (const user of users) {
      if (!isTeamsRecapDue(now, user.teamsTimezone)) continue;
      try {
        if (await this.sendIfNotSent(user.id, now)) sent += 1;
      } catch (err) {
        this.logger.error(`Teams weekly recap failed for user ${user.id}`, err as Error);
      }
    }
    if (sent > 0) this.logger.log(`Sent ${sent} Teams weekly recap(s)`);
    return sent;
  }

  async buildRecap(userId: number, now: Date = new Date()): Promise<TeamsWeeklyRecap> {
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const select = { id: true, title: true, personName: true } as const;
    const [resolved, waiting, pinned] = await Promise.all([
      this.prisma.workItem.findMany({
        where: { userId, status: 'RESOLVED', resolvedAt: { gte: weekAgo, lte: now } },
        orderBy: { resolvedAt: 'desc' },
        select,
      }),
      this.prisma.workItem.findMany({
        where: { userId, status: 'OPEN', kind: 'WAITING' },
        orderBy: { surfaceScore: 'desc' },
        select,
      }),
      this.prisma.workItem.findMany({
        where: { userId, isPinned: true, status: { not: 'DISMISSED' } },
        orderBy: { occurredAt: 'desc' },
        select,
      }),
    ]);
    return { resolved, waiting, pinned };
  }

  private async sendIfNotSent(userId: number, now: Date): Promise<boolean> {
    const { count } = await this.prisma.users.updateMany({
      where: {
        id: userId,
        OR: [
          { lastTeamsWeeklyRecapAt: null },
          { lastTeamsWeeklyRecapAt: { lt: new Date(now.getTime() - RECAP_GAP_MS) } },
        ],
      },
      data: { lastTeamsWeeklyRecapAt: now },
    });
    if (count === 0) return false;

    try {
      const recap = await this.buildRecap(userId, now);
      await this.sendMessage(
        userId,
        formatTeamsWeeklyRecap(recap, process.env.FRONTEND_URL),
      );
      return true;
    } catch (err) {
      await this.prisma.users.updateMany({
        where: { id: userId, lastTeamsWeeklyRecapAt: now },
        data: { lastTeamsWeeklyRecapAt: null },
      });
      throw err;
    }
  }

  private async sendMessage(userId: number, html: string): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { teamsTeamId: true, teamsChannelId: true },
    });
    if (!user?.teamsTeamId || !user.teamsChannelId) {
      throw new Error(`Teams channel is not configured for user ${userId}`);
    }
    const path = `/teams/${encodeURIComponent(user.teamsTeamId)}/channels/${encodeURIComponent(user.teamsChannelId)}/messages`;
    await this.graphRequest(userId, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { contentType: 'html', content: html } }),
    });
  }

  private async assertJoinedTeam(userId: number, teamId: string): Promise<void> {
    const teams = await this.listTeams(userId);
    if (!teams.some((team) => team.id === teamId)) {
      throw new BadRequestException('The selected team is not available to the connected account');
    }
  }

  private async graphCollection<T>(userId: number, initialPath: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | undefined = `${GRAPH_URL}${initialPath}`;
    while (next) {
      const nextUrl = new URL(next);
      if (nextUrl.protocol !== 'https:' || nextUrl.hostname !== 'graph.microsoft.com') {
        throw new Error('Microsoft Graph returned an invalid pagination URL');
      }
      const page = await this.graphRequest<{ value?: T[]; '@odata.nextLink'?: string }>(
        userId,
        nextUrl.toString(),
      );
      results.push(...(page.value ?? []));
      next = page['@odata.nextLink'];
    }
    return results;
  }

  private async graphRequest<T>(
    userId: number,
    pathOrUrl: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${GRAPH_URL}${pathOrUrl}`;
    let token = await this.accessToken(userId);
    let response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      token = await this.accessToken(userId, true);
      response = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || response.statusText;
      throw new Error(`Microsoft Graph request failed (${response.status}): ${message}`);
    }
    return payload as T;
  }

  private async accessToken(userId: number, forceRefresh = false): Promise<string> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        teamsAccessToken: true,
        teamsRefreshToken: true,
        teamsAccessTokenExpiresAt: true,
      },
    });
    if (!user?.teamsRefreshToken) {
      throw new Error(`Teams is not connected for user ${userId}`);
    }
    if (
      !forceRefresh &&
      user.teamsAccessToken &&
      user.teamsAccessTokenExpiresAt &&
      user.teamsAccessTokenExpiresAt.getTime() > Date.now() + TOKEN_REFRESH_MARGIN_MS
    ) {
      return user.teamsAccessToken;
    }

    const response = await fetch(`${this.authority()}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        grant_type: 'refresh_token',
        refresh_token: user.teamsRefreshToken,
        scope: GRAPH_SCOPES,
      }),
    });
    const tokens = await this.parseTokenResponse(response);
    const expiresAt = new Date(Date.now() + Number(tokens.expires_in) * 1000);
    await this.prisma.users.update({
      where: { id: userId },
      data: {
        teamsAccessToken: tokens.access_token,
        teamsRefreshToken: tokens.refresh_token ?? user.teamsRefreshToken,
        teamsAccessTokenExpiresAt: expiresAt,
      },
    });
    return tokens.access_token;
  }

  private async parseTokenResponse(response: Response): Promise<MicrosoftTokens> {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error(
        `Microsoft token request failed (${response.status}): ${payload.error_description || response.statusText}`,
      );
    }
    if (!Number.isFinite(Number(payload.expires_in)) || Number(payload.expires_in) <= 0) {
      throw new Error('Microsoft token response did not include a valid expiry');
    }
    return payload as MicrosoftTokens;
  }

  private async fetchProfile(accessToken: string): Promise<{
    id: string;
    mail?: string;
    userPrincipalName?: string;
  }> {
    const response = await fetch(`${GRAPH_URL}/me?$select=id,mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = await response.json().catch(() => ({}));
    if (!response.ok || !profile.id) {
      throw new Error(`Could not read the Microsoft account profile (${response.status})`);
    }
    return profile;
  }

  private authority(): string {
    const tenant = process.env.MICROSOFT_TENANT_ID || 'organizations';
    return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
  }

  private redirectUri(): string {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) throw new Error('BACKEND_URL is not configured');
    return `${backendUrl.replace(/\/$/, '')}/integrations/teams/oauth/callback`;
  }

  private clientId(): string {
    const value = process.env.MICROSOFT_CLIENT_ID;
    if (!value) throw new Error('MICROSOFT_CLIENT_ID is not configured');
    return value;
  }

  private clientSecret(): string {
    const value = process.env.MICROSOFT_CLIENT_SECRET;
    if (!value) throw new Error('MICROSOFT_CLIENT_SECRET is not configured');
    return value;
  }

  private jwtSecret(): string {
    const value = process.env.JWT_SECRET;
    if (!value) throw new Error('JWT_SECRET is not configured');
    return value;
  }
}
