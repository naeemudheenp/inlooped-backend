import {
  addLocalDays,
  isWeekdayAt,
  localParts,
  preferredTimezone,
  safeTimeZone,
  zonedTimeToUtc,
} from './time.util';

describe('time.util', () => {
  it('converts local wall time to UTC across DST', () => {
    // New York: EST (UTC-5) in November, EDT (UTC-4) in July.
    expect(zonedTimeToUtc(2026, 11, 10, 9, 0, 'America/New_York').toISOString()).toBe(
      '2026-11-10T14:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, 'America/New_York').toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    // Half-hour offset.
    expect(zonedTimeToUtc(2026, 11, 10, 9, 0, 'Asia/Kolkata').toISOString()).toBe(
      '2026-11-10T03:30:00.000Z',
    );
  });

  it('falls back to UTC for a missing or invalid zone', () => {
    expect(safeTimeZone('Not/A_Zone')).toBe('UTC');
    expect(safeTimeZone(null)).toBe('UTC');
    expect(zonedTimeToUtc(2026, 11, 10, 9, 0, 'Not/A_Zone').toISOString()).toBe(
      '2026-11-10T09:00:00.000Z',
    );
  });

  it('reads the local date, hour and weekday', () => {
    // 01:30 Tuesday in Kolkata while it is still Monday in UTC.
    const p = localParts(new Date('2026-11-09T20:00:00Z'), 'Asia/Kolkata');
    expect(p).toMatchObject({ year: 2026, month: 11, day: 10, hour: 1, minute: 30, weekday: 2 });
  });

  it('adds local days with month and year rollover', () => {
    expect(addLocalDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it('matches only the given hour on Monday to Friday', () => {
    // Monday 9:00 in New York.
    expect(isWeekdayAt(new Date('2026-11-09T14:00:00Z'), 'America/New_York', 9)).toBe(true);
    expect(isWeekdayAt(new Date('2026-11-09T14:59:00Z'), 'America/New_York', 9)).toBe(true);
    expect(isWeekdayAt(new Date('2026-11-09T15:00:00Z'), 'America/New_York', 9)).toBe(false);
    // Saturday 9:00 in New York.
    expect(isWeekdayAt(new Date('2026-11-14T14:00:00Z'), 'America/New_York', 9)).toBe(false);
  });

  it('prefers the time zone of a connected integration', () => {
    expect(
      preferredTimezone({
        slackEnabled: false,
        slackTimezone: 'UTC',
        teamsEnabled: true,
        teamsTimezone: 'Europe/Berlin',
      }),
    ).toBe('Europe/Berlin');
    expect(
      preferredTimezone({
        slackEnabled: true,
        slackTimezone: 'Asia/Kolkata',
        teamsEnabled: true,
        teamsTimezone: 'Europe/Berlin',
      }),
    ).toBe('Asia/Kolkata');
    expect(preferredTimezone({ slackEnabled: true, slackTimezone: 'bogus' })).toBe('UTC');
    expect(preferredTimezone(null)).toBe('UTC');
  });
});
