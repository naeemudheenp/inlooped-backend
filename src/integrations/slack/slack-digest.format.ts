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
