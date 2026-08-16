import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  location?: string;
  htmlLink?: string;
  hangoutLink?: string;
  isAllDay: boolean;
}

export interface GoogleCalendarSetting {
  id: string;
  summary: string;
  primary?: boolean;
  selected?: boolean;
}

const STATE_TTL = '10m';

@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  getOAuthUrl(userId: number): string {
    const redirectUri = `${process.env.BACKEND_URL}/integrations/google/oauth/callback`;
    const state = jwt.sign({ userId, purpose: 'google-install' }, this.secret(), {
      expiresIn: STATE_TTL,
    });

    const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
    const scopes = [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  verifyState(state: string): number {
    try {
      const payload = jwt.verify(state, this.secret()) as { userId?: number; purpose?: string };
      if (payload.purpose !== 'google-install' || !payload.userId) {
        throw new Error('wrong purpose');
      }
      return payload.userId;
    } catch {
      throw new UnauthorizedException('Invalid or expired Google auth state');
    }
  }

  async handleCallback(code: string, userId: number) {
    const redirectUri = `${process.env.BACKEND_URL}/integrations/google/oauth/callback`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    const data = await tokenRes.json();
    if (!data.access_token) {
      throw new Error(`Google OAuth failed: ${data.error_description || data.error || 'Unknown error'}`);
    }

    await this.prisma.users.update({
      where: { id: userId },
      data: {
        googleAccessToken: data.access_token,
        googleRefreshToken: data.refresh_token ?? undefined,
        googleEnabled: true,
        googleCalendarId: 'primary',
      },
    });

    return data;
  }

  async getEventsForDay(userId: number, dateStr?: string): Promise<CalendarEvent[]> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user || !user.googleEnabled || !user.googleAccessToken) {
      return [];
    }

    const token = await this.ensureValidToken(user);
    if (!token) return [];

    const date = dateStr ? new Date(dateStr) : new Date();
    const timeMin = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).toISOString();
    const timeMax = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59).toISOString();

    const calendarId = encodeURIComponent(user.googleCalendarId || 'primary');
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`;

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.items) return [];

      return data.items.map((e: any) => {
        const isAllDay = Boolean(e.start?.date);
        const startTime = e.start?.dateTime || `${e.start?.date}T00:00:00Z`;
        const endTime = e.end?.dateTime || `${e.end?.date}T23:59:59Z`;
        const hangoutLink =
          e.hangoutLink ||
          e.conferenceData?.entryPoints?.find((ep: any) => ep.entryPointType === "video")?.uri ||
          (e.location?.includes("meet.google.com") ? e.location : null);

        return {
          id: e.id,
          title: e.summary || '(No title)',
          description: e.description,
          startTime,
          endTime,
          location: e.location,
          htmlLink: e.htmlLink,
          hangoutLink,
          isAllDay,
        };
      });
    } catch (err) {
      this.logger.error(`Failed to fetch Google Calendar events for user ${userId}`, err as Error);
      return [];
    }
  }

  async listCalendars(userId: number): Promise<GoogleCalendarSetting[]> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user || !user.googleEnabled || !user.googleAccessToken) {
      return [];
    }

    const token = await this.ensureValidToken(user);
    if (!token) return [];

    try {
      const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.items) return [];

      return data.items.map((c: any) => ({
        id: c.id,
        summary: c.summary,
        primary: Boolean(c.primary),
        selected: c.id === (user.googleCalendarId || 'primary'),
      }));
    } catch {
      return [];
    }
  }

  async selectCalendar(userId: number, calendarId: string): Promise<void> {
    await this.prisma.users.update({
      where: { id: userId },
      data: { googleCalendarId: calendarId },
    });
  }

  async disconnect(userId: number): Promise<void> {
    await this.prisma.users.update({
      where: { id: userId },
      data: {
        googleAccessToken: null,
        googleRefreshToken: null,
        googleCalendarId: null,
        googleEnabled: false,
      },
    });
  }

  async getStatus(userId: number) {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    return {
      googleEnabled: Boolean(user?.googleEnabled),
      googleCalendarId: user?.googleCalendarId ?? 'primary',
    };
  }

  private async ensureValidToken(user: { id: number; googleAccessToken: string | null; googleRefreshToken: string | null }): Promise<string | null> {
    if (user.googleAccessToken) return user.googleAccessToken;
    if (!user.googleRefreshToken) return null;

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID ?? '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
          refresh_token: user.googleRefreshToken,
          grant_type: 'refresh_token',
        }),
      });

      const data = await res.json();
      if (data.access_token) {
        await this.prisma.users.update({
          where: { id: user.id },
          data: { googleAccessToken: data.access_token },
        });
        return data.access_token;
      }
    } catch { /* */ }
    return null;
  }

  private secret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return secret;
  }
}
