import {
  DigestItem,
  formatTodayReply,
  formatWeeklyRecap,
  isRecapDue,
} from './slack-digest.format';

describe('Slack digest formatting', () => {
  it('links Today items to their source or their Inlooped page', () => {
    const items: DigestItem[] = [
      { id: 'one', title: 'Review proposal', sourceUrl: 'https://slack.test/item' },
      { id: 'two', title: 'Plan release', sourceUrl: null },
    ];

    const reply = formatTodayReply(items, 'https://app.test');

    expect(reply).toContain('<https://slack.test/item|Review proposal>');
    expect(reply).toContain('<https://app.test/today?item=two|Plan release>');
  });

  it('formats the recap sections and settings link', () => {
    const recap = formatWeeklyRecap(
      {
        resolved: [],
        waiting: [{ id: 'waiting', title: 'Vendor response', sourceUrl: null }],
        pinned: [],
      },
      'https://app.test',
    );

    expect(recap).toContain('Resolved this week');
    expect(recap).toContain('<https://app.test/today?item=waiting|Vendor response>');
    expect(recap).toContain('turn this recap off in Slack settings');
  });

  it('schedules recaps on Tuesday at 8am in the user timezone', () => {
    expect(isRecapDue(new Date('2026-11-10T16:00:00Z'), 'America/Los_Angeles')).toBe(true);
    expect(isRecapDue(new Date('2026-11-10T15:00:00Z'), 'America/Los_Angeles')).toBe(false);
  });
});
