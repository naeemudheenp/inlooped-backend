import { isSnoozePreset, listSnoozePresets, snoozePresetTime } from './snooze-presets';

const NY = 'America/New_York';

describe('snooze presets', () => {
  // Monday 9 Nov 2026, 10:00 in New York (EST, UTC-5).
  const mondayMorning = new Date('2026-11-09T15:00:00Z');

  it('resolves tonight, tomorrow and next Monday in the user time zone', () => {
    expect(snoozePresetTime('tonight', mondayMorning, NY)?.toISOString()).toBe(
      '2026-11-09T23:00:00.000Z',
    );
    expect(snoozePresetTime('tomorrow', mondayMorning, NY)?.toISOString()).toBe(
      '2026-11-10T14:00:00.000Z',
    );
    // Today is Monday, so "next Monday" is a full week out.
    expect(snoozePresetTime('next_week', mondayMorning, NY)?.toISOString()).toBe(
      '2026-11-16T14:00:00.000Z',
    );
  });

  it('makes tonight unavailable once 6 pm has passed', () => {
    const evening = new Date('2026-11-09T23:30:00Z'); // 18:30 New York
    expect(snoozePresetTime('tonight', evening, NY)).toBeNull();

    const tonight = listSnoozePresets(evening, NY).find((p) => p.preset === 'tonight')!;
    expect(tonight).toMatchObject({ available: false, until: null });
  });

  it('uses the local date, not the UTC date', () => {
    // 01:30 Tuesday in Kolkata, still Monday in UTC.
    const now = new Date('2026-11-09T20:00:00Z');
    expect(snoozePresetTime('tonight', now, 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-11-10T12:30:00.000Z',
    );
    expect(snoozePresetTime('tomorrow', now, 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-11-11T03:30:00.000Z',
    );
  });

  it('keeps 9 am local across a DST change', () => {
    // Friday 30 Oct 2026, 11:00 EDT. US clocks go back on Sunday 1 Nov.
    const friday = new Date('2026-10-30T15:00:00Z');
    expect(snoozePresetTime('tomorrow', friday, NY)?.toISOString()).toBe(
      '2026-10-31T13:00:00.000Z', // 9:00 EDT
    );
    expect(snoozePresetTime('next_week', friday, NY)?.toISOString()).toBe(
      '2026-11-02T14:00:00.000Z', // 9:00 EST
    );
  });

  it('treats Monday as next week when today is Sunday', () => {
    const sunday = new Date('2026-11-08T15:00:00Z');
    expect(snoozePresetTime('next_week', sunday, 'UTC')?.toISOString()).toBe(
      '2026-11-09T09:00:00.000Z',
    );
  });

  it('lists every preset with a label', () => {
    const presets = listSnoozePresets(mondayMorning, NY);
    expect(presets.map((p) => p.preset)).toEqual(['tonight', 'tomorrow', 'next_week']);
    expect(presets.every((p) => p.available && p.label)).toBe(true);
    expect(isSnoozePreset('tomorrow')).toBe(true);
    expect(isSnoozePreset('someday')).toBe(false);
  });
});
