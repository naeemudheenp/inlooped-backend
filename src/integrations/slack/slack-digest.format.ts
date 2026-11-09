/**
 * Pure formatting and timing for the two Slack digests:
 *   INL-102 — the /today slash command
 *   INL-103 — the Tuesday weekly recap DM
 *
 * Kept free of Nest and Prisma so it can be unit-tested directly.
 */

export interface DigestItem {
  id?: string;
  title: string;
  sourceUrl: string | null;
  personName?: string | null;
}

export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function appItemUrl(frontendUrl: string | undefined, itemId: string | undefined): string | undefined {
  if (!frontendUrl || !itemId) return undefined;
  const url = new URL('/today', frontendUrl);
  url.searchParams.set('item', itemId);
  return url.toString();
}

export function slackLink(item: DigestItem, frontendUrl?: string): string {
  const title = escapeSlack(item.title);
  const url = item.sourceUrl || appItemUrl(frontendUrl, item.id);
  return url ? `<${url}|${title}>` : title;
}

function appLink(frontendUrl?: string): string {
  return frontendUrl ? `\n<${frontendUrl}|Open Inlooped>` : '';
}

export function formatTodayReply(items: DigestItem[], frontendUrl?: string): string {
  if (items.length === 0) {
    return `Nothing needs you today. 🎉${appLink(frontendUrl)}`;
  }
  const lines = items.map((item, i) => `${i + 1}. ${slackLink(item, frontendUrl)}`);
  return `*Your top ${items.length} for today*\n${lines.join('\n')}${appLink(frontendUrl)}`;
}

// ---- /today with a "⋯" menu per item (Block Kit) ----------------------------

export const TODAY_MENU_ACTION_PREFIX = 'today_item_menu';
export const TODAY_ACTIONS = ['done', 'tomorrow', 'next_week'] as const;
export type TodayAction = (typeof TODAY_ACTIONS)[number];

const TODAY_ACTION_LABELS: Record<TodayAction, string> = {
  done: 'Mark done',
  tomorrow: 'Tomorrow 9 am',
  next_week: 'Next week',
};

export function encodeTodayAction(action: TodayAction, itemId: string): string {
  return `${action}:${itemId}`;
}

export function parseTodayAction(value: unknown): { action: TodayAction; itemId: string } | null {
  const raw = String(value ?? '');
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;
  const action = raw.slice(0, sep);
  const itemId = raw.slice(sep + 1);
  if (!itemId || !(TODAY_ACTIONS as readonly string[]).includes(action)) return null;
  return { action: action as TodayAction, itemId };
}

export interface SlackMessage {
  text: string;
  blocks: Record<string, unknown>[];
}

/**
 * The /today reply as Block Kit: one section per item with an overflow ("⋯")
 * menu. `notice` is the confirmation line shown after a menu action, when the
 * reply is re-rendered in place.
 */
export function formatTodayBlocks(
  items: DigestItem[],
  frontendUrl?: string,
  notice?: string,
): SlackMessage {
  const blocks: Record<string, unknown>[] = [];
  if (notice) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: notice }] });
  }

  if (items.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: 'Nothing needs you today. 🎉' } });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Your top ${items.length} for today*` },
    });
    items.forEach((item, i) => {
      const section: Record<string, unknown> = {
        type: 'section',
        text: { type: 'mrkdwn', text: `${i + 1}. ${slackLink(item, frontendUrl)}` },
      };
      if (item.id) {
        section.accessory = {
          type: 'overflow',
          action_id: `${TODAY_MENU_ACTION_PREFIX}_${i}`,
          options: TODAY_ACTIONS.map((action) => ({
            text: { type: 'plain_text', text: TODAY_ACTION_LABELS[action] },
            value: encodeTodayAction(action, item.id!),
          })),
        };
      }
      blocks.push(section);
    });
  }

  if (frontendUrl) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `<${frontendUrl}|Open Inlooped>` }],
    });
  }

  const fallback = formatTodayReply(items, frontendUrl);
  return { text: notice ? `${notice}\n${fallback}` : fallback, blocks };
}

/** The confirmation line after a /today menu action. */
export function todayActionNotice(action: TodayAction, title: string): string {
  const shown = escapeSlack(title.length > 60 ? `${title.slice(0, 57)}...` : title);
  switch (action) {
    case 'done':
      return `✅ Marked *${shown}* done.`;
    case 'tomorrow':
      return `💤 Snoozed *${shown}* until tomorrow, 9 am.`;
    case 'next_week':
      return `💤 Snoozed *${shown}* until Monday, 9 am.`;
  }
}

// ---- Waiting-on nudge DM -----------------------------------------------------

export interface NudgeItem extends DigestItem {
  occurredAt: Date;
}

const DAY_MS = 86_400_000;

export function quietDays(occurredAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - occurredAt.getTime()) / DAY_MS));
}

export function formatSlackWaitingNudge(
  items: NudgeItem[],
  thresholdDays: number,
  now: Date,
  frontendUrl?: string,
): string {
  const lines = items.map((item) => {
    const who = item.personName ? `${escapeSlack(item.personName)} — ` : '';
    return `• ${who}${slackLink(item, frontendUrl)} · ${quietDays(item.occurredAt, now)} days`;
  });
  return [
    `⏳ *No reply for ${thresholdDays}+ days*`,
    lines.join('\n'),
    `_Worth a follow-up? Each item is only nudged once. Change this in Inlooped settings._${appLink(frontendUrl)}`,
  ].join('\n\n');
}

export interface WeeklyRecap {
  resolved: DigestItem[];
  waiting: DigestItem[];
  pinned: DigestItem[];
}

const RECAP_SECTION_LIMIT = 10;

function section(
  heading: string,
  items: DigestItem[],
  empty: string,
  frontendUrl?: string,
  withPerson = false,
): string {
  if (items.length === 0) return `*${heading}*\n_${empty}_`;
  const shown = items.slice(0, RECAP_SECTION_LIMIT).map((item) => {
    const who = withPerson && item.personName ? `${escapeSlack(item.personName)} — ` : '';
    return `• ${who}${slackLink(item, frontendUrl)}`;
  });
  const more = items.length - shown.length;
  if (more > 0) shown.push(`_…and ${more} more_`);
  return `*${heading}* (${items.length})\n${shown.join('\n')}`;
}

export function formatWeeklyRecap(recap: WeeklyRecap, frontendUrl?: string): string {
  return [
    '*Your week in Inlooped* 🗓️',
    section('Resolved this week', recap.resolved, 'Nothing resolved this week.', frontendUrl),
    section(
      'Still waiting on',
      recap.waiting,
      "You're not waiting on anyone.",
      frontendUrl,
      true,
    ),
    section('Pinned', recap.pinned, 'Nothing pinned.', frontendUrl),
    `_You can turn this recap off in Slack settings in Inlooped._${appLink(frontendUrl)}`,
  ].join('\n\n');
}

export const RECAP_WEEKDAY = 'Tue';
export const RECAP_HOUR = 8;

export function localWeekdayAndHour(
  now: Date,
  timeZone?: string | null,
): { weekday: string; hour: number } {
  const read = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    return {
      weekday: parts.find((p) => p.type === 'weekday')?.value ?? '',
      hour: Number(parts.find((p) => p.type === 'hour')?.value),
    };
  };
  try {
    return read(timeZone || 'UTC');
  } catch {
    return read('UTC');
  }
}

export function isRecapDue(now: Date, timeZone?: string | null): boolean {
  const { weekday, hour } = localWeekdayAndHour(now, timeZone);
  return weekday === RECAP_WEEKDAY && hour === RECAP_HOUR;
}
