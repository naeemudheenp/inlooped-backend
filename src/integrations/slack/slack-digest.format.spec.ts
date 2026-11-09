import {
  DigestItem,
  formatSlackWaitingNudge,
  formatTodayBlocks,
  formatTodayReply,
  formatWeeklyRecap,
  isRecapDue,
  parseTodayAction,
  todayActionNotice,
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

  describe('/today blocks', () => {
    const items: DigestItem[] = [
      { id: 'one', title: 'Review proposal', sourceUrl: 'https://slack.test/item' },
      { id: 'two', title: 'Plan release', sourceUrl: null },
    ];

    it('gives each item a "⋯" menu with done, tomorrow and next week', () => {
      const { blocks, text } = formatTodayBlocks(items, 'https://app.test');
      const sections = blocks.filter((b: any) => b.accessory) as any[];

      expect(sections).toHaveLength(2);
      expect(sections[0].accessory.type).toBe('overflow');
      expect(sections[0].accessory.options.map((o: any) => o.text.text)).toEqual([
        'Mark done',
        'Tomorrow 9 am',
        'Next week',
      ]);
      expect(sections[1].accessory.options.map((o: any) => o.value)).toEqual([
        'done:two',
        'tomorrow:two',
        'next_week:two',
      ]);
      // action_ids stay unique within the message.
      expect(new Set(sections.map((s) => s.accessory.action_id)).size).toBe(2);
      expect(text).toContain('Your top 2 for today');
    });

    it('puts the confirmation line first when re-rendered', () => {
      const { blocks, text } = formatTodayBlocks(items, undefined, '✅ Marked *X* done.');
      expect(blocks[0]).toEqual({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '✅ Marked *X* done.' }],
      });
      expect(text.startsWith('✅ Marked *X* done.')).toBe(true);
    });

    it('shows an empty state without menus', () => {
      const { blocks } = formatTodayBlocks([], 'https://app.test');
      expect(blocks.some((b: any) => b.accessory)).toBe(false);
      expect(JSON.stringify(blocks)).toContain('Nothing needs you today');
    });

    it('parses only known menu values', () => {
      expect(parseTodayAction('next_week:abc-123')).toEqual({
        action: 'next_week',
        itemId: 'abc-123',
      });
      expect(parseTodayAction('delete:abc')).toBeNull();
      expect(parseTodayAction('done:')).toBeNull();
      expect(parseTodayAction('done')).toBeNull();
      expect(parseTodayAction(undefined)).toBeNull();
    });

    it('escapes the item title in the confirmation line', () => {
      expect(todayActionNotice('done', '<b>Ship</b>')).toBe('✅ Marked *&lt;b&gt;Ship&lt;/b&gt;* done.');
      expect(todayActionNotice('tomorrow', 'Ship')).toContain('until tomorrow, 9 am');
      expect(todayActionNotice('next_week', 'Ship')).toContain('until Monday, 9 am');
    });
  });

  it('formats the waiting-on nudge with person and quiet days', () => {
    const now = new Date('2026-11-09T10:00:00Z');
    const message = formatSlackWaitingNudge(
      [
        {
          id: 'w1',
          title: 'Vendor quote',
          sourceUrl: null,
          personName: 'Ravi',
          occurredAt: new Date('2026-11-04T09:00:00Z'),
        },
      ],
      3,
      now,
      'https://app.test',
    );
    expect(message).toContain('No reply for 3+ days');
    expect(message).toContain('Ravi — <https://app.test/today?item=w1|Vendor quote> · 5 days');
    expect(message).toContain('only nudged once');
  });
});
