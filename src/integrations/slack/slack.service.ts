import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Bot scopes. `commands` is what makes /remember work; the *:history scopes let
 * us read back a message someone 📌-reacted to in a channel the bot is in.
 */
const BOT_SCOPES = [
  'chat:write',
  'im:write',
  'im:history',
  'channels:history',
  'groups:history',
  'users:read',
  'reactions:read',
  'commands',
].join(',');

/** The install link is a capability — keep its life short. */
const INSTALL_STATE_TTL = '10m';

@Injectable()
export class SlackService {
  constructor(private prisma: PrismaService) {}

  /**
   * `state` is signed rather than a bare user id.
   *
   * With a raw id, anyone could hand you a link that binds *their* Slack
   * workspace to *your* account — which is the exact CSRF the OAuth `state`
   * parameter exists to prevent. Signing it means the callback only accepts a
   * state this server minted, for the user who was authenticated at the time.
   */
  getSlackOAuthUrl(userId: number): string {
    const redirectUri = `${process.env.BACKEND_URL}/integrations/slack/oauth/callback`;
    const state = jwt.sign({ userId, purpose: 'slack-install' }, this.secret(), {
      expiresIn: INSTALL_STATE_TTL,
    });

    const params = new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? '',
      scope: BOT_SCOPES,
      user_scope: 'chat:write,search:read,channels:history,groups:history,im:history,mpim:history,channels:read,groups:read,im:read,mpim:read',
      state,
      redirect_uri: redirectUri,
    });

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  /** Throws unless the state is one we signed, unexpired, for this purpose. */
  verifyInstallState(state: string): number {
    try {
      const payload = jwt.verify(state, this.secret()) as {
        userId?: number;
        purpose?: string;
      };
      if (payload.purpose !== 'slack-install' || !payload.userId) {
        throw new Error('wrong purpose');
      }
      return payload.userId;
    } catch {
      throw new UnauthorizedException('Invalid or expired Slack install link');
    }
  }

  private secret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return secret;
  }

  /** Maps an inbound Slack (user, team) back to the numeric OpenNotepad userId. */
  async findUserBySlack(slackUserId: string, slackTeamId: string) {
    if (!slackUserId || !slackTeamId) return null;
    return this.prisma.users.findFirst({
      where: { slackUserId, slackTeamId, slackEnabled: true },
    });
  }

  /** Fetches the text of a single message (used to capture a 📌-reacted message in channels & DMs). */
  async fetchMessageText(botToken: string, channel: string, ts: string): Promise<string | null> {
    // 1. Try conversations.history
    let res = await fetch(
      `https://slack.com/api/conversations.history?channel=${channel}&latest=${ts}&oldest=${ts}&inclusive=true&limit=1`,
      { headers: { Authorization: `Bearer ${botToken}` } },
    );
    let data = await res.json();
    let msg = data.ok && data.messages?.length ? data.messages[0] : null;

    // 2. If not found in main channel history, try conversations.replies (for thread replies)
    if (!msg) {
      res = await fetch(
        `https://slack.com/api/conversations.replies?channel=${channel}&ts=${ts}&latest=${ts}&inclusive=true&limit=1`,
        { headers: { Authorization: `Bearer ${botToken}` } },
      );
      data = await res.json();
      if (data.ok && data.messages?.length) {
        msg = data.messages[0];
      }
    }

    if (!msg) {
      console.log('fetchMessageText-error', data);
      return null;
    }

    // Extract full text from message body and attachments
    let text = (msg.text ?? '').trim();
    if (msg.attachments?.length) {
      const attText = msg.attachments
        .map((a: any) => [a.text, a.fallback, a.pretext, a.title].filter(Boolean).join(' '))
        .filter(Boolean)
        .join('\n');
      if (attText && !text.includes(attText)) {
        text = text ? `${text}\n${attText}` : attText;
      }
    }
    return text || null;
  }

  async handleOAuthCallback(code: string, userId: number | string) {
    const redirectUri = `${process.env.BACKEND_URL}/integrations/slack/oauth/callback`;
  
    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
  
    const data = await tokenRes.json();
  
    if (!data.ok) {
      throw new Error(`Slack OAuth failed: ${data.error}`);
    }
  
    // Correct values
    const botToken = data.access_token;         // ✔ xoxb bot token
    const userToken = data.authed_user?.access_token; // ✔ xoxp user token
    const humanUserId = data.authed_user.id;    // ✔ Uxxxxxx
    const teamId = data.team.id;
  
    // SAVE CORRECT VALUES
    await this.prisma.users.update({
      where: { id: Number(userId) },
      data: {
        slackAccessToken: botToken,      // bot token (use this to send messages)
        slackUserToken: userToken,        // user token (use this to search/read messages)
        slackUserId: humanUserId,        // HUMAN user ID (open DM with this)
        slackTeamId: teamId,
        slackEnabled: true,
      }
    });
  
    return data;
  }
  
  async sendSlackMessage(botToken: string, slackUserId: string, text: string) {
    console.log("Sending Slack message:", { botToken, slackUserId, text });
  
    // Step 1 — Open a DM channel between bot and user
    const openRes = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        users: slackUserId   // this is the HUMAN user ID from Slack
      })
    });
  
    const openData = await openRes.json();
  
    if (!openData.ok) {
      console.error("Failed to open DM channel:", openData);
      return;
    }
  
    const channelId = openData.channel.id;
  
    // Step 2 — Send message to that channel
    const msgRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        channel: channelId,
        text
      })
    });
  
    const msgData = await msgRes.json();
  
    if (!msgData.ok) {
      console.error("Failed to send Slack message:", msgData);
      return;
    }
  
    console.log("Slack message sent successfully:", msgData);
  }

  async disconnect(userId: string) {
    await this.prisma.users.update({
      where: { id: Number(userId) },
      data: {
        slackAccessToken: null,
        slackUserId: null,
        slackTeamId: null,
        slackEnabled: false,
      }
    });
  }

  async sendTestMessage(userId: number) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });
  
    if (!user || !user.slackEnabled || !user.slackAccessToken) {
      return { ok: false, message: "Slack not connected for this user" };
    }
  
    await this.sendSlackMessage(
      user.slackAccessToken,
      user.slackUserId,
      "🎉 This is a test message from OpenNotepad! Slack integration is working perfectly 🚀"
    );
  
    return { ok: true, message: "Test message sent successfully!" };
  }

  async sendBotMessage(
    botToken: string,
    slackUserId: string,
    text: string,
    channelId?: string,
    threadTs?: string,
  ) {
    // Attempt 1: Try posting to the channel/thread if channelId was provided
    if (channelId) {
      const payload: any = {
        channel: channelId,
        text,
      };
      if (threadTs) {
        payload.thread_ts = threadTs;
      }

      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.ok) {
        return; // Successfully posted in target channel/thread
      }
      console.log(
        `Notice: Could not post directly to channel ${channelId} (${data.error}). Falling back to DM with user ${slackUserId}.`,
      );
    }

    // Attempt 2 (Fallback): Open a 1-on-1 DM channel with the user and post confirmation there
    const dmRes = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ users: slackUserId }),
    });

    const dmData = await dmRes.json();
    if (!dmData.ok) {
      console.error('DM-open-error:', dmData);
      return;
    }

    const fallbackRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: dmData.channel.id,
        text,
      }),
    });

    const fallbackData = await fallbackRes.json();
    if (!fallbackData.ok) {
      console.error('Failed to post fallback DM message:', fallbackData);
    }
  }

  async listChannels(botToken: string): Promise<any[]> {
    let channels: any[] = [];
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({
        types: 'public_channel,private_channel,im,mpim',
        limit: '100',
        ...(cursor ? { cursor } : {}),
      });
      const res = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`Slack API error in conversations.list: ${data.error}`);
        break;
      }
      channels = channels.concat(data.channels || []);
      cursor = data.response_metadata?.next_cursor;
    } while (cursor);
    return channels;
  }

  async listUsers(botToken: string): Promise<Record<string, string>> {
    const res = await fetch(`https://slack.com/api/users.list`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = await res.json();
    if (!data.ok) return {};
    const map: Record<string, string> = {};
    for (const member of data.members || []) {
      map[member.id] = member.profile?.real_name || member.name || member.id;
    }
    return map;
  }

  async getChannelHistory(
    token: string,
    channelId: string,
    oldest: string,
    latest: string,
  ): Promise<any[]> {
    const params = new URLSearchParams({
      channel: channelId,
      oldest,
      latest,
      limit: '100',
    });
    const res = await fetch(`https://slack.com/api/conversations.history?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`Failed to fetch history for channel ${channelId}: ${data.error}`);
      return [];
    }
    return data.messages || [];
  }

  async getThreadReplies(
    token: string,
    channelId: string,
    threadTs: string,
  ): Promise<any[]> {
    const params = new URLSearchParams({
      channel: channelId,
      ts: threadTs,
      limit: '100',
    });
    const res = await fetch(`https://slack.com/api/conversations.replies?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`Failed to fetch replies for thread ${threadTs} in channel ${channelId}: ${data.error}`);
      return [];
    }
    return data.messages || [];
  }

  getPermalink(teamId?: string, channel?: string, ts?: string): string | undefined {
    if (!teamId || !channel || !ts) return undefined;
    return `https://app.slack.com/client/${teamId}/${channel}/p${ts.replace('.', '')}`;
  }

  async searchUserMessages(userToken: string, query: string): Promise<any[]> {
    const params = new URLSearchParams({
      query,
      count: '100',
    });
    const res = await fetch(`https://slack.com/api/search.messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`Failed to search messages for query "${query}": ${data.error}`);
      return [];
    }
    return data.messages?.matches || [];
  }
}
