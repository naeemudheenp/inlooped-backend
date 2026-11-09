import { SlackEventsService } from './slack-events.service';

const USER = { id: 7, slackTimezone: 'America/New_York' };
const ITEM = { id: 'item-1', title: 'Review proposal' };

function setup(opts: { owned?: boolean; user?: boolean } = {}) {
  const slack = {
    findUserBySlack: jest.fn().mockResolvedValue(opts.user === false ? null : USER),
    respond: jest.fn().mockResolvedValue(true),
  };
  const surface = {
    findForUser: jest.fn().mockResolvedValue(opts.owned === false ? null : ITEM),
    markDone: jest.fn().mockResolvedValue(ITEM),
    snoozeToPreset: jest.fn().mockResolvedValue(new Date()),
    topOpen: jest
      .fn()
      .mockResolvedValue([{ id: 'item-2', title: 'Plan release', sourceUrl: null }]),
  };
  const service = new SlackEventsService(slack as any, {} as any, surface as any);
  return { service, slack, surface };
}

function payload(value: string, actionId = 'today_item_menu_0') {
  return {
    type: 'block_actions',
    user: { id: 'U1', team_id: 'T1' },
    team: { id: 'T1' },
    response_url: 'https://hooks.slack.com/actions/T1/1/abc',
    actions: [{ action_id: actionId, type: 'overflow', selected_option: { value } }],
  };
}

describe('/today menu actions', () => {
  it('marks done and updates the private reply in place', async () => {
    const { service, slack, surface } = setup();

    await service.handleBlockActions(payload('done:item-1'));

    expect(slack.findUserBySlack).toHaveBeenCalledWith('U1', 'T1');
    expect(surface.findForUser).toHaveBeenCalledWith(7, 'item-1');
    expect(surface.markDone).toHaveBeenCalledWith(7, 'item-1');
    const [url, body] = slack.respond.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/actions/T1/1/abc');
    expect(body.replace_original).toBe(true);
    expect(body.response_type).toBe('ephemeral');
    expect(body.blocks[0].elements[0].text).toBe('✅ Marked *Review proposal* done.');
    // The refreshed list follows the confirmation line.
    expect(JSON.stringify(body.blocks)).toContain('Plan release');
  });

  it.each([
    ['tomorrow', 'until tomorrow, 9 am'],
    ['next_week', 'until Monday, 9 am'],
  ])('snoozes to %s in the Slack time zone', async (action, copy) => {
    const { service, slack, surface } = setup();

    await service.handleBlockActions(payload(`${action}:item-1`));

    expect(surface.snoozeToPreset).toHaveBeenCalledWith(7, 'item-1', action, 'America/New_York');
    expect(surface.markDone).not.toHaveBeenCalled();
    expect(slack.respond.mock.calls[0][1].blocks[0].elements[0].text).toContain(copy);
  });

  it("won't touch an item the clicking user doesn't own", async () => {
    const { service, slack, surface } = setup({ owned: false });

    await service.handleBlockActions(payload('done:someone-elses'));

    expect(surface.markDone).not.toHaveBeenCalled();
    expect(slack.respond.mock.calls[0][1].blocks[0].elements[0].text).toContain(
      'no longer in Inlooped',
    );
  });

  it('reports a failed update but still refreshes the list', async () => {
    const { service, slack, surface } = setup();
    surface.snoozeToPreset.mockRejectedValue(new Error('db down'));

    await service.handleBlockActions(payload('tomorrow:item-1'));

    const body = slack.respond.mock.calls[0][1];
    expect(body.blocks[0].elements[0].text).toContain("couldn't update that item");
    expect(JSON.stringify(body.blocks)).toContain('Plan release');
  });

  it('asks an unconnected user to connect', async () => {
    const { service, slack, surface } = setup({ user: false });

    await service.handleBlockActions(payload('done:item-1'));

    expect(surface.findForUser).not.toHaveBeenCalled();
    expect(slack.respond.mock.calls[0][1].text).toContain('Connect Slack');
  });

  it('ignores other interactive actions and malformed values', async () => {
    const { service, slack } = setup();

    await service.handleBlockActions(payload('done:item-1', 'some_other_button'));
    await service.handleBlockActions(payload('explode:item-1'));

    expect(slack.respond).not.toHaveBeenCalled();
  });
});
