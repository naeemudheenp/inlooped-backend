import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SlackService } from '../integrations/slack/slack.service';
import { LLM_SERVICE, LlmService } from '../llm/llm.types';
import * as crypto from 'crypto';

export interface JournalEntryView {
  id: string;
  /** YYYY-MM-DD */
  day: string;
  body: string;
  updatedAt: Date;
}

const JOURNAL_GEN_SYSTEM = `You are a workspace daily journal assistant. Your job is to analyze the user's daily Slack activity (provided as conversation blocks) and reconstruct a precise, professional daily work journal for the user (whose Slack real name is {userName} and Slack User ID is {slackUserId}).

## Journal Philosophy
The journal should feel like: "This is what I accomplished today."
It should NOT feel like: "Here is everything that happened in Slack today."
Do not simply summarize Slack. Focus only on the user's work, not a generic team summary.
For example, if a team discusses "We should redesign the dashboard" but the user does not participate meaningfully, this should not become part of the user's journal. If the user says "I'll handle the dashboard redesign," then it becomes relevant.

## Noise Filtering
Ignore greetings, casual conversations, memes, jokes, messages unrelated to the user's work, and messages where the user only reacted without meaningful contribution.

## Daily Journal Structure
Your daily journal MUST be written in Markdown, titled with:
### Your Day — {dateFormatted}

Followed by these sections (only include a section if there are items for it; omit empty sections entirely):

**Worked on**
* A bulleted list of meaningful work items the user worked on. For every item, append the Slack deep link from the conversation block: [View in Slack →](url)
Example: * Investigated PostHog group properties. [View in Slack →](https://...)

**Decisions**
* Bulleted list of decisions made by/with the user. [View in Slack →](url)

**Completed**
* Bulleted list of work items completed by the user. [View in Slack →](url)

**Follow-ups**
* Bulleted list of follow-up actions for the user. [View in Slack →](url)

**Blockers**
* Bulleted list of blockers for the user. [View in Slack →](url)

For each bullet point, write a concise, active summary in sentence case, no trailing period. E.g., "Investigated PostHog group properties" instead of "There was a discussion about PostHog."

## AI Extraction of Work Items
For every meaningful work item listed in the journal (under Worked on, Decisions, Completed, Follow-ups, or Blockers), you must also produce a structured representation containing:
1. title: Short noun phrase (2-6 words), sentence case, no trailing period. E.g., "PostHog event implementation".
2. detail: 1-2 plain sentences. Address the user as "you". E.g., "You added the missing event tracking to the Inbox layout."
3. kind: One of "TASK", "WAITING", "REFERENCE", "REMEMBER".
   - TASK: Something needing action/attention.
   - WAITING: User is blocked on someone else.
   - REFERENCE: Context/FYI, not a call to action.
   - REMEMBER: Explicit reminder in the user's voice.
4. status: "OPEN" or "RESOLVED" (RESOLVED if completed/done, otherwise OPEN).
5. personName: First name only of the other person involved (e.g. "Macbeth"), if any.
6. topic: 1-2 lowercase keywords (e.g. "posthog", "analytics").
7. importance: Float (0.0 to 1.0) based on long-term value.
8. confidence: Float (0.0 to 1.0) for your extraction.
   - High (0.8 - 1.0): Clear evidence user did/owned the work.
   - Medium (0.4 - 0.7): Strong indication but not completely explicit.
   - Low (0.1 - 0.3): Inferred possible work (low confidence). NOTE: Low confidence items should be marked clearly in detail or omitted if too speculative.
9. occurredAt: ISO timestamp of when the conversation happened.
10. slackMessageUrl: The URL of the original Slack conversation block.

You must combine multiple messages/replies from the same conversation into a single work item instead of creating duplicates.

Return only a JSON object matching the requested schema.`;

const JOURNAL_GEN_SCHEMA = {
  type: 'object',
  properties: {
    journalMarkdown: {
      type: 'string',
      description: 'The concise daily journal formatted in Markdown as specified.'
    },
    workItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          kind: { type: 'string', enum: ['TASK', 'WAITING', 'REFERENCE', 'REMEMBER'] },
          status: { type: 'string', enum: ['OPEN', 'RESOLVED'] },
          personName: { type: 'string' },
          topic: { type: 'string' },
          importance: { type: 'number' },
          confidence: { type: 'number' },
          occurredAt: { type: 'string' },
          slackMessageUrl: { type: 'string' }
        },
        required: ['title', 'detail', 'kind', 'status', 'importance', 'confidence', 'occurredAt', 'slackMessageUrl']
      }
    }
  },
  required: ['journalMarkdown', 'workItems']
};

@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slackService: SlackService,
    @Inject(LLM_SERVICE) private readonly llm: LlmService,
  ) {}

  async get(userId: number, day: string): Promise<JournalEntryView | null> {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { userId_day: { userId, day: toDate(day) } },
    });
    return entry ? view(entry) : null;
  }

  /** Autosave target. Empty body deletes rather than leaving a blank row. */
  async upsert(userId: number, day: string, body: string): Promise<JournalEntryView | null> {
    const date = toDate(day);
    const trimmed = body.trim();

    if (!trimmed) {
      await this.prisma.journalEntry
        .delete({ where: { userId_day: { userId, day: date } } })
        .catch(() => undefined); // nothing there is a fine outcome
      return null;
    }

    const entry = await this.prisma.journalEntry.upsert({
      where: { userId_day: { userId, day: date } },
      create: { userId, day: date, body: trimmed },
      update: { body: trimmed },
    });
    return view(entry);
  }

  async list(userId: number, limit = 30): Promise<JournalEntryView[]> {
    const entries = await this.prisma.journalEntry.findMany({
      where: { userId },
      orderBy: { day: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return entries.map(view);
  }

  /**
   * Reconstruct the user's day from Slack conversations and store it as a Daily Journal
   * and relevant WorkItems.
   */
  async syncSlackJournalForUser(
    userId: number,
    day: string,
  ): Promise<{ journal: string; workItemsCreated: number }> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user || !user.slackEnabled || !user.slackAccessToken || !user.slackUserId) {
      throw new Error('Slack integration not fully configured or connected for this user');
    }

    const timezone = user.slackTimezone || 'UTC';
    const { oldestSecs, latestSecs } = getLocalRangeInUtc(day, timezone);

    // 1. Fetch workspace users list to map IDs to real names
    const usersMap = await this.slackService.listUsers(user.slackUserToken || user.slackAccessToken);
    const targetUserName = usersMap[user.slackUserId] || user.name || 'User';

    const relevantGroups: Array<{
      channelName: string;
      url: string;
      messages: Array<{ sender: string; text: string; ts: string }>;
    }> = [];

    if (user.slackUserToken) {
      // --- USER TOKEN SEARCH-BASED SYNC (No bot invites required) ---
      const dayBeforeObj = new Date((oldestSecs - 24 * 3600) * 1000);
      const dayBefore = dayBeforeObj.toISOString().split('T')[0];

      // Search for messages sent by the user or mentioning the user
      const sentMatches = await this.slackService.searchUserMessages(
        user.slackUserToken,
        `from:me after:${dayBefore}`,
      );
      const mentionMatches = await this.slackService.searchUserMessages(
        user.slackUserToken,
        `<@${user.slackUserId}> after:${dayBefore}`,
      );

      // Combine and filter to messages sent strictly within the target day
      const allMatches = [...sentMatches, ...mentionMatches];
      const todayMatches = allMatches.filter((m) => {
        const ts = Number(m.ts);
        return ts >= oldestSecs && ts <= latestSecs;
      });

      // Group into unique threads and unique channels (for standalone messages)
      const threadsToFetch = new Map<string, { channelId: string; channelName: string }>();
      const channelsWithStandalone = new Map<string, string>();

      for (const m of todayMatches) {
        const channelId = m.channel?.id;
        const channelName = m.channel?.name || 'direct-message';
        if (!channelId) continue;

        if (m.thread_ts) {
          threadsToFetch.set(m.thread_ts, { channelId, channelName });
        } else {
          channelsWithStandalone.set(channelId, channelName);
        }
      }

      // Fetch full thread replies (to capture context around user's messages)
      for (const [threadTs, info] of threadsToFetch.entries()) {
        const replies = await this.slackService.getThreadReplies(
          user.slackUserToken,
          info.channelId,
          threadTs,
        );

        const threadMessages = replies.map((r) => ({
          sender: usersMap[r.user] || r.user || 'Unknown',
          text: r.text || '',
          ts: r.ts,
        }));

        const permalink = this.slackService.getPermalink(user.slackTeamId, info.channelId, threadTs) || '';

        relevantGroups.push({
          channelName: info.channelName,
          url: permalink,
          messages: threadMessages,
        });
      }

      // Fetch standalone history for active channels
      for (const [channelId, channelName] of channelsWithStandalone.entries()) {
        const mainMessages = await this.slackService.getChannelHistory(
          user.slackUserToken,
          channelId,
          String(oldestSecs),
          String(latestSecs),
        );

        // Keep only standalone messages (no thread replies)
        const standaloneToday = mainMessages.filter((msg) => !msg.thread_ts);
        if (standaloneToday.length === 0) continue;

        standaloneToday.sort((a, b) => Number(a.ts) - Number(b.ts));

        // Group by 30-minute gaps
        let currentGroup: any[] = [];
        const groups: any[][] = [];

        for (const msg of standaloneToday) {
          if (currentGroup.length === 0) {
            currentGroup.push(msg);
          } else {
            const lastMsg = currentGroup[currentGroup.length - 1];
            const diff = Number(msg.ts) - Number(lastMsg.ts);
            if (diff <= 1800) {
              currentGroup.push(msg);
            } else {
              groups.push(currentGroup);
              currentGroup = [msg];
            }
          }
        }
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }

        // Add groups where user participated
        for (const group of groups) {
          const userParticipated = group.some(
            (m) => m.user === user.slackUserId || (m.text && m.text.includes(`<@${user.slackUserId}>`))
          );

          if (userParticipated) {
            const groupMessages = group.map((m) => ({
              sender: usersMap[m.user] || m.user || 'Unknown',
              text: m.text || '',
              ts: m.ts,
            }));

            const firstMsgTs = group[0].ts;
            const permalink = this.slackService.getPermalink(user.slackTeamId, channelId, firstMsgTs) || '';

            relevantGroups.push({
              channelName,
              url: permalink,
              messages: groupMessages,
            });
          }
        }
      }
    } else {
      // --- BOT-BASED FALLBACK SYNC (Requires bot to be in channels) ---
      const channels = await this.slackService.listChannels(user.slackAccessToken);
      const botChannels = channels.filter(
        (c) => c.is_member || c.is_im || c.is_mpim
      );

      // Fetch history for each channel going back 3 days to capture active threads
      const oldestSearch = oldestSecs - 3 * 24 * 3600;

      for (const channel of botChannels) {
        const mainMessages = await this.slackService.getChannelHistory(
          user.slackAccessToken,
          channel.id,
          String(oldestSearch),
          String(latestSecs),
        );

        // Separate main channel messages into standalone and threaded
        const standaloneToday: any[] = [];
        const threadsToFetch = new Map<string, any>(); // thread_ts -> parent message

        for (const msg of mainMessages) {
          const ts = Number(msg.ts);
          if (msg.thread_ts) {
            threadsToFetch.set(msg.thread_ts, msg);
          } else if (ts >= oldestSecs && ts <= latestSecs) {
            standaloneToday.push(msg);
          }
        }

        // Process threads
        for (const [threadTs, parentMsg] of threadsToFetch.entries()) {
          const replies = await this.slackService.getThreadReplies(
            user.slackAccessToken,
            channel.id,
            threadTs,
          );

          // Keep replies that occurred today
          const repliesToday = replies.filter((r) => {
            const ts = Number(r.ts);
            return ts >= oldestSecs && ts <= latestSecs;
          });

          if (repliesToday.length > 0) {
            // User participated if they sent a message or were mentioned
            const userParticipated = repliesToday.some(
              (r) => r.user === user.slackUserId || (r.text && r.text.includes(`<@${user.slackUserId}>`))
            );

            if (userParticipated) {
              const threadMessages = replies.map((r) => ({
                sender: usersMap[r.user] || r.user || 'Unknown',
                text: r.text || '',
                ts: r.ts,
              }));

              const permalink = this.slackService.getPermalink(user.slackTeamId, channel.id, threadTs) || '';

              relevantGroups.push({
                channelName: channel.name || 'direct-message',
                url: permalink,
                messages: threadMessages,
              });
            }
          }
        }

        // Process standalone channel messages
        if (standaloneToday.length > 0) {
          // Sort ascending
          standaloneToday.sort((a, b) => Number(a.ts) - Number(b.ts));

          // Group by 30-minute gaps
          let currentGroup: any[] = [];
          const groups: any[][] = [];

          for (const msg of standaloneToday) {
            if (currentGroup.length === 0) {
              currentGroup.push(msg);
            } else {
              const lastMsg = currentGroup[currentGroup.length - 1];
              const diff = Number(msg.ts) - Number(lastMsg.ts);
              if (diff <= 1800) {
                currentGroup.push(msg);
              } else {
                groups.push(currentGroup);
                currentGroup = [msg];
              }
            }
          }
          if (currentGroup.length > 0) {
            groups.push(currentGroup);
          }

          // For each group, check if user participated
          for (const group of groups) {
            const userParticipated = group.some(
              (m) => m.user === user.slackUserId || (m.text && m.text.includes(`<@${user.slackUserId}>`))
            );

            if (userParticipated) {
              const groupMessages = group.map((m) => ({
                sender: usersMap[m.user] || m.user || 'Unknown',
                text: m.text || '',
                ts: m.ts,
              }));

              const firstMsgTs = group[0].ts;
              const permalink = this.slackService.getPermalink(user.slackTeamId, channel.id, firstMsgTs) || '';

              relevantGroups.push({
                channelName: channel.name || 'direct-message',
                url: permalink,
                messages: groupMessages,
              });
            }
          }
        }
      }
    }

    // 5. If no activity, return a placeholder
    if (relevantGroups.length === 0) {
      const noActivityMarkdown = `### Your Day — ${formatLongDate(day)}\n\nNo Slack activity found for this day.`;
      await this.upsert(userId, day, noActivityMarkdown);
      return { journal: noActivityMarkdown, workItemsCreated: 0 };
    }

    // 6. Construct prompt and call LLM
    const formattedBlocks = relevantGroups
      .map((group, index) => {
        const msgs = group.messages
          .map((m) => {
            const time = new Date(Number(m.ts) * 1000).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            });
            return `[${time}] ${group.channelName === 'direct-message' ? '' : m.sender}: ${m.text}`;
          })
          .join('\n');
        return `--- CONVERSATION BLOCK ${index + 1} ---\nChannel: #${group.channelName}\nURL: ${group.url}\nMessages:\n${msgs}`;
      })
      .join('\n\n');

    const systemPrompt = JOURNAL_GEN_SYSTEM
      .replace('{userName}', targetUserName)
      .replace('{slackUserId}', user.slackUserId)
      .replace('{dateFormatted}', formatLongDate(day));

    let journalMarkdown = '';
    let extractedWorkItems: any[] = [];

    if (this.llm.isAvailable()) {
      try {
        const response = await this.llm.complete<any>({
          system: systemPrompt,
          user: formattedBlocks,
          maxOutputTokens: 16384,
          tier: 'strong',
          jsonSchema: JOURNAL_GEN_SCHEMA as unknown as Record<string, unknown>,
          label: 'journal-sync',
        });

        if (response.json) {
          journalMarkdown = response.json.journalMarkdown || '';
          extractedWorkItems = response.json.workItems || [];
        }
      } catch (err) {
        console.error('LLM daily journal sync failed:', err);
      }
    }

    if (!journalMarkdown) {
      // Fallback: simple text description if LLM fails
      journalMarkdown = `### Your Day — ${formatLongDate(day)}\n\n* Sync attempted, but LLM service was temporarily unavailable. Custom work items were not extracted.`;
    }

    // 7. Store journal markdown — append to existing entry if present
    const existing = await this.prisma.journalEntry.findUnique({
      where: { userId_day: { userId, day: toDate(day) } },
    });

    let finalBody = journalMarkdown;

    if (existing?.body) {
      const slackHeader = '### Your Day —';
      const existingBody = existing.body.trim();

      // Check if the existing entry already has a Slack-generated section
      const slackSectionIdx = existingBody.indexOf(slackHeader);

      if (slackSectionIdx >= 0) {
        // Replace the old Slack section with the new one, keep everything before it
        const beforeSlack = existingBody.slice(0, slackSectionIdx).trim();
        finalBody = beforeSlack
          ? `${beforeSlack}\n\n---\n\n${journalMarkdown}`
          : journalMarkdown;
      } else {
        // No prior Slack section — append below existing user content
        finalBody = `${existingBody}\n\n---\n\n${journalMarkdown}`;
      }
    }

    await this.upsert(userId, day, finalBody);

    // 8. Store custom work items
    let createdCount = 0;
    for (const item of extractedWorkItems) {
      const itemTitle = item.title || 'Slack Activity';
      const itemUrl = item.slackMessageUrl || '';
      
      const sourceHash = crypto
        .createHash('sha256')
        .update(`${userId}:${itemUrl}:${itemTitle}`)
        .digest('hex');

      await this.prisma.workItem.upsert({
        where: { userId_sourceHash: { userId, sourceHash } },
        create: {
          userId,
          kind: item.kind || 'REFERENCE',
          status: item.status || 'OPEN',
          title: itemTitle,
          detail: item.detail || '',
          sourceText: item.detail || itemTitle,
          sourceHash,
          sourceApp: 'slack',
          sourceUrl: itemUrl,
          sourceChannel: null,
          personName: item.personName || null,
          topic: item.topic || null,
          importance: item.importance || 0.5,
          confidence: item.confidence || 0.5,
          occurredAt: item.occurredAt ? new Date(item.occurredAt) : new Date(),
        },
        update: {
          status: item.status || 'OPEN',
          title: itemTitle,
          detail: item.detail || '',
          personName: item.personName || null,
          topic: item.topic || null,
          importance: item.importance || 0.5,
          confidence: item.confidence || 0.5,
        },
      });
      createdCount++;
    }

    return { journal: finalBody, workItemsCreated: createdCount };
  }

  /**
   * Cron job running automatically to generate/update daily journals
   * for active users based on their recent Slack activity, strictly within
   * their local working hours (9:00 AM - 7:30 PM).
   */
  @Cron(CronExpression.EVERY_3_HOURS)
  async runScheduledDailyJournalSync(): Promise<void> {
    this.logger.log('Running scheduled check for Daily Slack Journal Sync...');
    const users = await this.prisma.users.findMany({
      where: { slackEnabled: true, slackAccessToken: { not: null } },
    });

    const now = new Date();
    for (const user of users) {
      const userTz = user.slackTimezone || 'UTC';
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: userTz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: 'numeric',
          minute: '2-digit',
          hour12: false,
        });
        const parts = formatter.formatToParts(now);
        const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
        const year = getPart('year');
        const month = getPart('month');
        const day = getPart('day');
        const hour = parseInt(getPart('hour'), 10);
        const minute = parseInt(getPart('minute'), 10);

        // Strictly enforce 9:00 AM - 7:30 PM (19:30) window in user's timezone
        const timeInMinutes = hour * 60 + minute;
        const startMinutes = 9 * 60; // 9:00 AM
        const endMinutes = 19 * 60 + 30; // 7:30 PM

        if (timeInMinutes < startMinutes || timeInMinutes > endMinutes) {
          this.logger.log(
            `Skipping sync for user ${user.id} (${user.email}): local time is ${hour}:${minute.toString().padStart(2, '0')}, outside 9:00 AM - 7:30 PM window.`,
          );
          continue;
        }

        const dayKey = `${year}-${month}-${day}`;
        this.logger.log(`Running scheduled sync for user ${user.id} (${user.email}) for day ${dayKey}`);
        await this.syncSlackJournalForUser(user.id, dayKey);
      } catch (err) {
        this.logger.error(`Scheduled sync failed for user ${user.id}`, err as Error);
      }
    }
  }
}

function view(e: { id: string; day: Date; body: string; updatedAt: Date }): JournalEntryView {
  return { id: e.id, day: e.day.toISOString().slice(0, 10), body: e.body, updatedAt: e.updatedAt };
}

/** Dates are stored as DATE; parse as UTC midnight so no timezone shifts the day. */
function toDate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Invalid day "${day}", expected YYYY-MM-DD`);
  }
  return new Date(`${day}T00:00:00.000Z`);
}

function formatLongDate(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00.000Z`);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/**
 * Convert a local YYYY-MM-DD day to start and end UTC timestamps (in seconds)
 * using the user's timezone.
 */
export function getLocalRangeInUtc(dayStr: string, timezone: string = 'UTC'): { oldestSecs: number; latestSecs: number } {
  try {
    const tempDate = new Date(`${dayStr}T00:00:00.000Z`);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    }).formatToParts(tempDate);

    const getPart = (type: string) => Number(parts.find((p) => p.type === type)?.value);

    const localDateAsUtc = Date.UTC(
      getPart('year'),
      getPart('month') - 1,
      getPart('day'),
      getPart('hour'),
      getPart('minute'),
      getPart('second'),
    );

    const offsetMs = tempDate.getTime() - localDateAsUtc;

    const startUtc = new Date(tempDate.getTime() + offsetMs);
    const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000 - 1000);

    return {
      oldestSecs: Math.floor(startUtc.getTime() / 1000),
      latestSecs: Math.floor(endUtc.getTime() / 1000),
    };
  } catch (e) {
    const startUtc = new Date(`${dayStr}T00:00:00.000Z`);
    const endUtc = new Date(`${dayStr}T23:59:59.000Z`);
    return {
      oldestSecs: Math.floor(startUtc.getTime() / 1000),
      latestSecs: Math.floor(endUtc.getTime() / 1000),
    };
  }
}
