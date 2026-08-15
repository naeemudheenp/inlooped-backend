import { Injectable, Logger } from '@nestjs/common';
import { SlackService } from './slack.service';
import { IngestService, CaptureRoute } from '../../ingest/ingest.service';

/** Reactions that mean "send this to Inlooped". */
const CAPTURE_REACTIONS = new Set([
  'pushpin',
  'round_pushpin',
  'bookmark',
  'star',
  'star2',
  'glowing_star',
  'floppy_disk',
  'memo',
  'inbox_tray',
  'inlooped',
  'pin',
  'save',
]);

/**
 * Every inbound Slack path — a DM, a 📌 reaction, the message shortcut, the
 * /remember command — funnels into IngestService.capture(). Slack decides
 * *what* arrives; ingest decides what it means. Keeping that split is what lets
 * a new source (email, a share sheet) reuse the whole understanding pipeline.
 */
@Injectable()
export class SlackEventsService {
  private readonly logger = new Logger(SlackEventsService.name);

  constructor(
    private readonly slack: SlackService,
    private readonly ingest: IngestService,
  ) {}

  /** Handles a verified Events API `event_callback` payload. */
  async handleEvent(event: any, teamId: string): Promise<void> {
    if (!event || !teamId) return;

    if (event.type === 'message') {
      // Ignore the bot's own posts.
      if (event.bot_id) return;

      // Ignore system noise subtypes (deletions, joins, leaves, topic changes).
      const ignoredSubtypes = new Set([
        'message_deleted',
        'message_changed',
        'channel_join',
        'channel_leave',
        'channel_topic',
        'channel_purpose',
        'group_join',
        'group_leave',
      ]);
      if (event.subtype && ignoredSubtypes.has(event.subtype)) return;

      // Extract text from text property, attachments (forwarded messages), blocks, or nested message
      let text = (event.text ?? '').trim();

      if (event.message?.text) {
        const msgText = event.message.text.trim();
        if (msgText && !text.includes(msgText)) {
          text = text ? `${text}\n${msgText}` : msgText;
        }
      }

      const attachments = event.attachments || event.message?.attachments || [];
      if (attachments.length) {
        const attachmentTexts = attachments
          .map((a: any) => {
            const parts = [a.text, a.fallback, a.pretext, a.title, a.author_name].filter(Boolean);
            if (a.fields?.length) {
              for (const f of a.fields) {
                if (f.title) parts.push(f.title);
                if (f.value) parts.push(f.value);
              }
            }
            return parts.join(' ').trim();
          })
          .filter(Boolean)
          .join('\n')
          .trim();

        if (attachmentTexts && !text.includes(attachmentTexts)) {
          text = text ? `${text}\n${attachmentTexts}` : attachmentTexts;
        }
      }

      const slackUserId = event.user || event.message?.user || event.user_id;
      if (!slackUserId || !text) return;

      this.logger.log(
        `Processing Slack message from ${slackUserId} (subtype: ${event.subtype || 'none'}): "${text}"`,
      );

      await this.capture(slackUserId, teamId, text, {
        channel: event.channel,
        ts: event.ts,
      });
      return;
    }

    if (event.type === 'reaction_added') {
      if (!CAPTURE_REACTIONS.has(event.reaction)) return;
      if (event.item?.type !== 'message') return;
      await this.captureFromReaction(event.user, teamId, event.item.channel, event.item.ts);
    }
  }

  /** Message shortcut ("Send to Inlooped"). */
  async handleShortcut(payload: any): Promise<void> {
    const slackUserId = payload?.user?.id;
    const teamId = payload?.team?.id;
    const text = payload?.message?.text;
    if (!slackUserId || !teamId || !text) return;

    await this.capture(slackUserId, teamId, text, {
      channel: payload?.channel?.id,
      ts: payload?.message?.ts,
    });
  }

  /**
   * `/remember <thing>`. The command is the intent — forceKind short-circuits
   * classification entirely, so this path never spends a token.
   */
  async handleRememberCommand(payload: {
    user_id?: string;
    team_id?: string;
    text?: string;
    channel_id?: string;
  }): Promise<void> {
    const slackUserId = payload.user_id;
    const teamId = payload.team_id;
    const text = (payload.text ?? '').trim();
    if (!slackUserId || !teamId || !text) return;

    const user = await this.slack.findUserBySlack(slackUserId, teamId);
    if (!user) return;

    const { route } = await this.ingest.capture({
      userId: user.id,
      text,
      sourceApp: 'slack',
      sourceChannel: payload.channel_id,
      forceKind: 'REMEMBER',
    });

    await this.confirm(user, this.confirmation(route));
  }

  // -- internals -----------------------------------------------------------

  private async captureFromReaction(
    slackUserId: string,
    teamId: string,
    channel: string,
    ts: string,
  ): Promise<void> {
    const user = await this.slack.findUserBySlack(slackUserId, teamId);
    if (!user) return;

    const text = await this.slack.fetchMessageText(user.slackAccessToken, channel, ts);
    if (!text) {
      this.logger.warn(
        `Could not read 📌-reacted message for user ${user.id} in ${channel} — the bot may not be in that conversation.`,
      );
      await this.confirm(
        user,
        "📌 I saw your pin, but couldn't read that message. Add me to the channel and try again.",
      );
      return;
    }

    await this.captureForUser(user, text, { channel, ts });
  }

  private async capture(
    slackUserId: string,
    teamId: string,
    text: string,
    ref: { channel?: string; ts?: string },
  ): Promise<void> {
    const user = await this.slack.findUserBySlack(slackUserId, teamId);
    if (!user) {
      this.logger.warn(
        `Slack event received for user ${slackUserId} (team ${teamId}), but no matching connected user found in DB.`,
      );
      return;
    }
    await this.captureForUser(user, text, ref);
  }

  private async captureForUser(
    user: { id: number; slackAccessToken: string; slackUserId: string; slackTeamId: string },
    text: string,
    ref: { channel?: string; ts?: string },
  ): Promise<void> {
    try {
      const { item, route } = await this.ingest.capture({
        userId: user.id,
        text,
        sourceApp: 'slack',
        sourceChannel: ref.channel,
        sourceUrl: this.permalink(user.slackTeamId, ref.channel, ref.ts),
      });
      this.logger.log(`Captured for user ${user.id} (${route})`);
      await this.confirm(user, this.confirmation(route, item, text), ref.channel, ref.ts);
    } catch (err) {
      this.logger.error(`Capture failed for user ${user.id}`, err as Error);
    }
  }

  /** Deep link for "Open in Slack". */
  private permalink(teamId?: string, channel?: string, ts?: string): string | undefined {
    if (!teamId || !channel || !ts) return undefined;
    return `https://app.slack.com/client/${teamId}/${channel}/p${ts.replace('.', '')}`;
  }

  /**
   * Generates a context-rich confirmation message with item summary/title.
   */
  private confirmation(route: CaptureRoute, item?: any, text?: string): string {
    const rawPreview = item?.title || text || '';
    const preview = rawPreview
      ? `"${rawPreview.length > 60 ? rawPreview.slice(0, 57) + '...' : rawPreview}"`
      : '';

    switch (route) {
      case 'duplicate':
      case 'near-duplicate':
        return `✅ Already had this: ${preview}`;
      case 'command':
        return `✅ I'll bring that back: ${preview}`;
      default:
        return `✅ Got it! Saved to Inlooped: ${preview}`;
    }
  }

  private async confirm(
    user: { id: number; slackAccessToken: string; slackUserId: string },
    text: string,
    channel?: string,
    ts?: string,
  ) {
    try {
      await this.slack.sendBotMessage(user.slackAccessToken, user.slackUserId, text, channel, ts);
    } catch (err) {
      this.logger.error(`Failed to confirm to user ${user.id}`, err as Error);
    }
  }
}
