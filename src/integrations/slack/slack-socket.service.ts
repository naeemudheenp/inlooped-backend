import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SocketModeClient } from '@slack/socket-mode';
import { SlackEventsService, slashCommandName } from './slack-events.service';

/**
 * Connects to Slack over Socket Mode (a persistent WebSocket) so inbound events
 * work from localhost with NO public URL / ngrok. Enabled only when
 * SLACK_APP_TOKEN (an app-level `xapp-...` token with connections:write) is set;
 * otherwise it no-ops and the HTTP /events endpoint remains available for prod.
 *
 * Dispatches to the same SlackEventsService the HTTP path uses, so capture
 * behaviour is identical either way.
 */
@Injectable()
export class SlackSocketService implements OnModuleInit {
	private readonly logger = new Logger(SlackSocketService.name);
	private client?: SocketModeClient;

	constructor(private readonly events: SlackEventsService) {}

	async onModuleInit() {
		const appToken = process.env.SLACK_APP_TOKEN;
		if (!appToken) {
			this.logger.log(
				'SLACK_APP_TOKEN not set — Socket Mode disabled. (Set it to capture Slack events locally without ngrok.)',
			);
			return;
		}

		this.client = new SocketModeClient({ appToken });

		// Log every incoming Socket Mode payload for debugging
		this.client.on('slack_event', async ({ type, body }: any) => {
			this.logger.log(`[SocketMode] Event received: type=${type}, eventType=${body?.event?.type || 'none'}`);
		});

		// Events API: direct messages to the bot (DM capture + prompt replies).
		this.client.on('message', async ({ ack, event, body }: any) => {
			await this.safeAck(ack);
			this.logger.log(`[SocketMode] Received 'message' event from user ${event?.user} in channel ${event?.channel}`);
			await this.events.handleEvent(event, body?.team_id);
		});

		// Events API: 📌 reactions.
		this.client.on('reaction_added', async ({ ack, event, body }: any) => {
			await this.safeAck(ack);
			await this.events.handleEvent(event, body?.team_id);
		});

		// Interactivity: the "Send to Inlooped" message shortcut, and the "⋯"
		// menu on /today items.
		this.client.on('interactive', async ({ ack, body }: any) => {
			await this.safeAck(ack);
			if (body?.type === 'message_action') {
				await this.events.handleShortcut(body);
			}
			if (body?.type === 'block_actions') {
				await this.events.handleBlockActions(body);
			}
		});

		// Slash commands: /remember, /today. Socket Mode delivers these too, so
		// the commands work from localhost with no public URL.
		this.client.on('slash_commands', async ({ ack, body }: any) => {
			const command = slashCommandName(body?.command);
			if (command === 'today') {
				const reply = await this.events.handleTodayCommand(body);
				await this.safeAck(ack, { response_type: 'ephemeral', ...reply });
				return;
			}
			await this.safeAck(ack);
			if (command === 'remember') {
				await this.events.handleRememberCommand(body);
			}
		});

		this.client.on('disconnected', () =>
			this.logger.warn('Slack Socket Mode disconnected (will auto-reconnect).'),
		);

		try {
			await this.client.start();
			this.logger.log('Slack Socket Mode connected — inbound capture is live.');
		} catch (err) {
			this.logger.error('Failed to start Slack Socket Mode', err as any);
		}
	}

	private async safeAck(ack?: (response?: any) => Promise<void>, response?: any) {
		try {
			await (response === undefined ? ack?.() : ack?.(response));
		} catch {
			// ignore — a failed ack only triggers a harmless Slack retry
		}
	}
}
