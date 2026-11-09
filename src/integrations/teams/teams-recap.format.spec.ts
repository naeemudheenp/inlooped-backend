import {
  formatTeamsCapture,
  formatTeamsTodayDigest,
  formatTeamsWaitingNudge,
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

  it('formats the Today digest as a numbered list with escaped meta', () => {
    const message = formatTeamsTodayDigest(
      [
        { id: 'a', title: 'Review <proposal>', meta: 'waiting on Ravi' },
        { id: 'b', title: 'Plan release', meta: null },
      ],
      'https://app.example',
    );
    expect(message).toContain('Your top 2 for today');
    expect(message).toContain('<ol>');
    expect(message).toContain('Review &lt;proposal&gt;');
    expect(message).toContain('<i>— waiting on Ravi</i>');
    expect(message).toContain('https://app.example/today?item=b');
    expect(message).toContain('turn this daily digest off');
  });

  it('formats the waiting-on nudge and escapes the person', () => {
    const message = formatTeamsWaitingNudge(
      [{ id: 'w', title: 'Quote', personName: '<Ravi>', occurredAt: new Date('2026-11-01T00:00:00Z') }],
      7,
      new Date('2026-11-09T10:00:00Z'),
    );
    expect(message).toContain('No reply for 7+ days');
    expect(message).toContain('&lt;Ravi&gt; — Quote · 8 days');
  });
});
