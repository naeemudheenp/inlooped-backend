import {
  formatTeamsCapture,
  formatTeamsWeeklyRecap,
  isTeamsRecapDue,
} from './teams-recap.format';

describe('Teams notification formatting', () => {
  it('escapes captured content and links to the item in the app', () => {
    const message = formatTeamsCapture(
      { id: 'item-1', title: '<script>alert("x")</script>', kind: 'TASK' },
      'https://app.example',
    );

    expect(message).toContain('&lt;script&gt;');
    expect(message).not.toContain('<script>');
    expect(message).toContain('https://app.example/today?item=item-1');
  });

  it('formats all recap sections and escapes user content', () => {
    const message = formatTeamsWeeklyRecap({
      resolved: [{ title: 'Done' }],
      waiting: [{ title: 'Waiting', personName: '<Alex>' }],
      pinned: [],
    });

    expect(message).toContain('Resolved this week (1)');
    expect(message).toContain('Still waiting on (1)');
    expect(message).toContain('&lt;Alex&gt;');
    expect(message).toContain('Nothing pinned.');
  });

  it('sends the recap at 8 AM Tuesday in the configured timezone', () => {
    expect(isTeamsRecapDue(new Date('2026-11-10T08:00:00Z'), 'UTC')).toBe(true);
    expect(isTeamsRecapDue(new Date('2026-11-10T09:00:00Z'), 'UTC')).toBe(
      false,
    );
  });
});
