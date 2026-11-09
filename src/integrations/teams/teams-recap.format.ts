export interface TeamsDigestItem {
  id?: string;
  title: string;
  personName?: string | null;
}

export interface TeamsWeeklyRecap {
  resolved: TeamsDigestItem[];
  waiting: TeamsDigestItem[];
  pinned: TeamsDigestItem[];
}

const RECAP_WEEKDAY = 'Tue';
const RECAP_HOUR = 8;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function itemLabel(item: TeamsDigestItem, frontendUrl?: string): string {
  const title = escapeHtml(item.title);
  if (!frontendUrl || !item.id) return title;
  const url = new URL('/today', frontendUrl);
  url.searchParams.set('item', item.id);
  return `<a href="${escapeHtml(url.toString())}">${title}</a>`;
}

function section(
  heading: string,
  items: TeamsDigestItem[],
  empty: string,
  frontendUrl?: string,
  withPerson = false,
): string {
  const lines = items.slice(0, 10).map((item) => {
    const who =
      withPerson && item.personName ? `${escapeHtml(item.personName)} — ` : '';
    return `<li>${who}${itemLabel(item, frontendUrl)}</li>`;
  });
  if (items.length > lines.length)
    lines.push(`<li>…and ${items.length - lines.length} more</li>`);
  return `<p><b>${heading} (${items.length})</b></p>${lines.length ? `<ul>${lines.join('')}</ul>` : `<p><i>${empty}</i></p>`}`;
}

export function formatTeamsWeeklyRecap(
  recap: TeamsWeeklyRecap,
  frontendUrl?: string,
): string {
  return [
    '<h2>Your week in Inlooped</h2>',
    section(
      'Resolved this week',
      recap.resolved,
      'Nothing resolved this week.',
      frontendUrl,
    ),
    section(
      'Still waiting on',
      recap.waiting,
      "You're not waiting on anyone.",
      frontendUrl,
      true,
    ),
    section('Pinned', recap.pinned, 'Nothing pinned.', frontendUrl),
    frontendUrl
      ? `<p><a href="${escapeHtml(frontendUrl)}">Open Inlooped</a></p>`
      : '',
  ]
    .filter(Boolean)
    .join('');
}

export function formatTeamsCapture(
  item: { id: string; title: string; kind: string },
  frontendUrl?: string,
): string {
  const title = escapeHtml(item.title);
  const link = frontendUrl ? itemLabel(item, frontendUrl) : title;
  return `<p><b>New ${escapeHtml(item.kind.toLowerCase())} captured</b></p><p>${link}</p>`;
}

export interface TeamsTodayItem extends TeamsDigestItem {
  /** "waiting on Ravi", "3 messages", "since Thursday" */
  meta?: string | null;
}

/** Weekday 9 am post: the user's top open items. */
export function formatTeamsTodayDigest(
  items: TeamsTodayItem[],
  frontendUrl?: string,
): string {
  const lines = items.map((item) => {
    const meta = item.meta ? ` <i>— ${escapeHtml(item.meta)}</i>` : '';
    return `<li>${itemLabel(item, frontendUrl)}${meta}</li>`;
  });
  return [
    `<h2>Your top ${items.length} for today</h2>`,
    `<ol>${lines.join('')}</ol>`,
    `<p><i>You can turn this daily digest off in Teams settings in Inlooped.</i>${
      frontendUrl ? ` <a href="${escapeHtml(frontendUrl)}">Open Inlooped</a>` : ''
    }</p>`,
  ].join('');
}

export interface TeamsNudgeItem extends TeamsDigestItem {
  occurredAt: Date;
}

/** "No reply for N+ days" — WAITING items gone quiet. */
export function formatTeamsWaitingNudge(
  items: TeamsNudgeItem[],
  thresholdDays: number,
  now: Date,
  frontendUrl?: string,
): string {
  const lines = items.map((item) => {
    const who = item.personName ? `${escapeHtml(item.personName)} — ` : '';
    const days = Math.max(
      0,
      Math.floor((now.getTime() - item.occurredAt.getTime()) / 86_400_000),
    );
    return `<li>${who}${itemLabel(item, frontendUrl)} · ${days} days</li>`;
  });
  return [
    `<p><b>⏳ No reply for ${thresholdDays}+ days</b></p>`,
    `<ul>${lines.join('')}</ul>`,
    '<p><i>Worth a follow-up? Each item is only nudged once. Change this in Inlooped settings.</i></p>',
  ].join('');
}

export function isTeamsRecapDue(now: Date, timeZone?: string | null): boolean {
  const read = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);
    return {
      weekday: parts.find((part) => part.type === 'weekday')?.value ?? '',
      hour: Number(parts.find((part) => part.type === 'hour')?.value),
    };
  };

  try {
    const { weekday, hour } = read(timeZone || 'UTC');
    return weekday === RECAP_WEEKDAY && hour === RECAP_HOUR;
  } catch {
    const { weekday, hour } = read('UTC');
    return weekday === RECAP_WEEKDAY && hour === RECAP_HOUR;
  }
}
