/**
 * Wall-clock helpers for "9 am in the user's time zone" style scheduling.
 *
 * Pure and dependency-free (Intl only) so the snooze presets, the Teams digest
 * and the waiting-on nudges all agree on what "local 9 am" means — and so it
 * can be unit-tested without Nest or Prisma.
 */

export interface LocalParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function isValidTimeZone(tz?: string | null): tz is string {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(tz?: string | null): string {
  return isValidTimeZone(tz) ? tz : 'UTC';
}

/** The calendar date and clock time `instant` shows on a wall in `tz`. */
export function localParts(instant: Date, tz?: string | null): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(tz),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

/** Local minus UTC, in ms, at `instant`. */
function offsetMs(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads the given local time.
 * Two passes so a DST change between the guess and the answer is accounted for.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz?: string | null,
): Date {
  const zone = safeTimeZone(tz);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = wall - offsetMs(new Date(wall), zone);
  return new Date(wall - offsetMs(new Date(firstGuess), zone));
}

/** Calendar arithmetic on a local date — month and year rollover included. */
export function addLocalDays(
  date: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** True during the given local hour on Monday–Friday. */
export function isWeekdayAt(now: Date, tz: string | null | undefined, hour: number): boolean {
  const p = localParts(now, tz);
  return p.weekday >= 1 && p.weekday <= 5 && p.hour === hour;
}

export interface TimezoneSource {
  slackEnabled?: boolean | null;
  slackTimezone?: string | null;
  teamsEnabled?: boolean | null;
  teamsTimezone?: string | null;
}

/**
 * The user's own time zone. Each integration stores one; prefer whichever
 * integration is actually connected, then any valid value, then UTC.
 */
export function preferredTimezone(user: TimezoneSource | null | undefined): string {
  if (!user) return 'UTC';
  const candidates = [
    user.slackEnabled ? user.slackTimezone : null,
    user.teamsEnabled ? user.teamsTimezone : null,
    user.slackTimezone,
    user.teamsTimezone,
  ];
  return candidates.find((tz) => isValidTimeZone(tz)) ?? 'UTC';
}
