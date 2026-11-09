import { addLocalDays, localParts, zonedTimeToUtc } from '../common/time.util';

/**
 * Named snooze targets, resolved in the user's own time zone:
 *   tonight   → today 6 pm (unavailable once 6 pm has passed)
 *   tomorrow  → tomorrow 9 am
 *   next_week → the coming Monday 9 am (a week out when today is Monday)
 */
export const SNOOZE_PRESETS = ['tonight', 'tomorrow', 'next_week'] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

export const SNOOZE_PRESET_LABELS: Record<SnoozePreset, string> = {
  tonight: 'Tonight, 6 pm',
  tomorrow: 'Tomorrow, 9 am',
  next_week: 'Next Monday, 9 am',
};

const TONIGHT_HOUR = 18;
const MORNING_HOUR = 9;
const MONDAY = 1;

export function isSnoozePreset(value: unknown): value is SnoozePreset {
  return (SNOOZE_PRESETS as readonly unknown[]).includes(value);
}

/** The instant a preset means right now, or null when it is no longer reachable. */
export function snoozePresetTime(preset: SnoozePreset, now: Date, tz: string): Date | null {
  const today = localParts(now, tz);

  switch (preset) {
    case 'tonight': {
      const at = zonedTimeToUtc(today.year, today.month, today.day, TONIGHT_HOUR, 0, tz);
      return at.getTime() > now.getTime() ? at : null;
    }
    case 'tomorrow': {
      const d = addLocalDays(today, 1);
      return zonedTimeToUtc(d.year, d.month, d.day, MORNING_HOUR, 0, tz);
    }
    case 'next_week': {
      // Days until the next Monday strictly after today: Sun→1, Mon→7, Fri→3.
      const ahead = (7 + MONDAY - today.weekday) % 7 || 7;
      const d = addLocalDays(today, ahead);
      return zonedTimeToUtc(d.year, d.month, d.day, MORNING_HOUR, 0, tz);
    }
  }
}

export interface SnoozePresetOption {
  preset: SnoozePreset;
  label: string;
  until: string | null;
  available: boolean;
}

/** What a snooze menu should offer right now — the client renders this as-is. */
export function listSnoozePresets(now: Date, tz: string): SnoozePresetOption[] {
  return SNOOZE_PRESETS.map((preset) => {
    const until = snoozePresetTime(preset, now, tz);
    return {
      preset,
      label: SNOOZE_PRESET_LABELS[preset],
      until: until ? until.toISOString() : null,
      available: Boolean(until),
    };
  });
}
