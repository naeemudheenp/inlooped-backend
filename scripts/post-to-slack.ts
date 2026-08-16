/**
 * Script to post realistic test data (channels, messages, threads, mentions)
 * between Naeemudheen and Macbeth directly into a live Slack Workspace via Slack API.
 *
 * Usage:
 *   SLACK_BOT_TOKEN="xoxb-..." npx ts-node scripts/post-to-slack.ts
 *   or:
 *   npx ts-node scripts/post-to-slack.ts --token "xoxb-..."
 */
import * as dotenv from 'dotenv';
dotenv.config();

const token = process.argv.includes('--token')
  ? process.argv[process.argv.indexOf('--token') + 1]
  : process.env.SLACK_BOT_TOKEN || process.env.SLACK_APP_TOKEN || process.env.SLACK_ACCESS_TOKEN;

if (!token) {
  console.error('\n❌ ERROR: Slack Bot Token is required!');
  console.error('Please pass --token "xoxb-..." or set SLACK_BOT_TOKEN in .env\n');
  process.exit(1);
}

interface TestConversation {
  channelName: string;
  isPrivate?: boolean;
  topic?: string;
  messages: Array<{
    userSender: 'Naeemudheen' | 'Macbeth' | 'Bot';
    text: string;
    replies?: Array<{ userSender: 'Naeemudheen' | 'Macbeth'; text: string }>;
  }>;
}

const CONVERSATIONS_TO_POST: TestConversation[] = [
  {
    channelName: 'test-engineering',
    topic: 'Engineering discussions and technical tasks',
    messages: [
      {
        userSender: 'Macbeth',
        text: 'Hey Naeem (@naeemudheen), seeing 800ms+ latency on vector search during peak queries today. Can you take a look at the pgvector index performance?',
        replies: [
          {
            userSender: 'Naeemudheen',
            text: 'On it! I will profile the query execution plan and check if the HNSW index is being used properly.',
          },
          {
            userSender: 'Macbeth',
            text: 'Awesome, let me know if you need fresh database logs.',
          },
        ],
      },
      {
        userSender: 'Naeemudheen',
        text: 'Macbeth: we need to add exponential backoff retry to the Slack OAuth token refresh handler. Slack hit us with rate limits during bulk sync tests.',
        replies: [
          {
            userSender: 'Macbeth',
            text: 'Good call. I will add a retry decorator with jitter to the Slack API client.',
          },
        ],
      },
    ],
  },
  {
    channelName: 'test-product-sync',
    topic: 'Product roadmap and feature reviews',
    messages: [
      {
        userSender: 'Naeemudheen',
        text: '@macbeth uploaded the OpenAPI spec draft for the new Surface API. Let me know if the schema looks good for the desktop app integration: https://api.inlooped.app/v1/openapi.json',
        replies: [
          {
            userSender: 'Macbeth',
            text: 'Will review this afternoon right after the client sync!',
          },
        ],
      },
      {
        userSender: 'Macbeth',
        text: 'For the Mac menu bar companion app, let us register `Cmd+Shift+I` globally. If pressed anywhere, it opens the quick note capture modal.',
        replies: [
          {
            userSender: 'Naeemudheen',
            text: 'Perfect, that avoids conflict with standard browser developer tools shortcuts.',
          },
        ],
      },
    ],
  },
  {
    channelName: 'test-support-escalations',
    topic: 'Customer issues and production alerts',
    messages: [
      {
        userSender: 'Macbeth',
        text: '🚨 @naeemudheen 3 customers reported payment confirmation hanging at 99%. Looks like the Stripe webhook handler is timing out waiting for DB connection pool.',
        replies: [
          {
            userSender: 'Naeemudheen',
            text: 'Looking at the connection pool metrics now. Looks like pool size was capped at 10 in production config.',
          },
          {
            userSender: 'Macbeth',
            text: 'Bumped max pool size to 25. Let us monitor latency over the next 30 mins.',
          },
        ],
      },
    ],
  },
];

async function slackApiCall(endpoint: string, body: any) {
  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!json.ok) {
    // If channel already exists, ignore error
    if (json.error === 'name_taken') {
      return { ok: true, channelAlreadyExists: true };
    }
    console.warn(`⚠️ Slack API Warning [${endpoint}]:`, json.error || json);
  }
  return json;
}

async function getOrCreateChannel(channelName: string): Promise<string | null> {
  console.log(`\n📁 Preparing channel: #${channelName}`);
  const createRes = await slackApiCall('conversations.create', {
    name: channelName,
    is_private: false,
  });

  if (createRes.channel?.id) {
    return createRes.channel.id;
  }

  // If already exists, list channels to get ID
  const listRes = await slackApiCall('conversations.list', {
    types: 'public_channel,private_channel',
    limit: 1000,
  });

  if (listRes.channels) {
    const found = listRes.channels.find((c: any) => c.name === channelName);
    if (found) {
      // Ensure bot joins channel
      await slackApiCall('conversations.join', { channel: found.id });
      return found.id;
    }
  }

  return null;
}

async function postMessages() {
  console.log('🚀 Starting Slack Live Test Data Generation...\n');

  for (const item of CONVERSATIONS_TO_POST) {
    const channelId = await getOrCreateChannel(item.channelName);
    if (!channelId) {
      console.error(`❌ Could not get or join channel #${item.channelName}. Skipping...`);
      continue;
    }

    if (item.topic) {
      await slackApiCall('conversations.setTopic', {
        channel: channelId,
        topic: item.topic,
      });
    }

    for (const msg of item.messages) {
      console.log(`  💬 Posting message from ${msg.userSender}...`);
      const formattedText = `*[${msg.userSender}]* ${msg.text}`;

      const parentRes = await slackApiCall('chat.postMessage', {
        channel: channelId,
        text: formattedText,
      });

      if (parentRes.ok && parentRes.ts && msg.replies) {
        for (const reply of msg.replies) {
          console.log(`    ↳ Posting threaded reply from ${reply.userSender}...`);
          const replyText = `*[${reply.userSender}]* ${reply.text}`;
          await slackApiCall('chat.postMessage', {
            channel: channelId,
            thread_ts: parentRes.ts,
            text: replyText,
          });
        }
      }
    }
  }

  console.log('\n✅ Live Slack Test Data generation completed!');
}

postMessages().catch((err) => {
  console.error('Fatal error during posting:', err);
  process.exit(1);
});
