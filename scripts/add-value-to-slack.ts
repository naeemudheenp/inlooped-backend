/**
 * Large Scale Project Simulator: Naeemudheen & Macbeth Working on Enterprise System
 *
 * Usage:
 *   cd inlooped-app/inlooped-backend
 *   npx ts-node scripts/add-value-to-slack.ts
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

interface SlackMessageItem {
  sender: 'Naeemudheen' | 'Macbeth' | 'System Bot';
  text: string;
  replies?: Array<{
    sender: 'Naeemudheen' | 'Macbeth' | 'System Bot';
    text: string;
  }>;
}

const LARGE_PROJECT_CONVERSATIONS: SlackMessageItem[] = [
  // 1. Architecture: Distributed Event Queue Migration
  {
    sender: 'Macbeth',
    text: 'Hey <@U0BGWSH1ZMJ>, we are hitting 15,000 events/sec on the ingress gateway for Project HyperLoop. The single-node Redis Pub/Sub queue is starting to drop messages during spikes. I think we need to migrate to Kafka or AWS SQS with FIFO processing.\n\nHere is the proposal doc: https://wiki.internal/arch/event-bus-v2',
    replies: [
      {
        sender: 'Naeemudheen',
        text: '<@U0BPVPEUJ4U> fully agree. I reviewed the RFC. SQS FIFO will give us guaranteed ordering per workspace partition without the ops overhead of running a multi-broker Kafka cluster.\n\nLet us benchmark consumer throughput with 50 worker pods in staging first.',
      },
      {
        sender: 'Macbeth',
        text: 'Awesome. I will set up the Terraform scripts for SQS FIFO queues and dead-letter queues (DLQ) with a maxReceiveCount of 5.',
      },
      {
        sender: 'Naeemudheen',
        text: 'Great. I will write the NestJS `SqsConsumerService` module with automatic backoff and worker pooling. I will post the PR link once built.',
      },
    ],
  },

  // 2. Incident & Emergency Hotfix: Connection Pool Exhaustion
  {
    sender: 'Macbeth',
    text: '🚨 *INCIDENT #4092 - SEV 1*: Postgres active connection pool exhausted on `db-primary-us-east-1`! 500 Internal Server Errors spike across all API endpoints.\n\n`pg_stat_activity` count: 200/200 connections active (State: `idle in transaction`).',
    replies: [
      {
        sender: 'Naeemudheen',
        text: 'Looking now! Traced it to the new `JournalService.syncHistory()` query added in PR #204. It opened a transaction without a `try/finally` block to release connections on error.',
      },
      {
        sender: 'Macbeth',
        text: 'I just killed the stuck idle transactions on DB primary:\n```sql\nSELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = \'idle in transaction\' AND age(clock_timestamp(), query_start) > \'1 minute\'::interval;\n```\nAPI error rate dropped back to 0%!',
      },
      {
        sender: 'Naeemudheen',
        text: 'Deploying hotfix PR #208 right now with standard timeout wrapper `prisma.$transaction(..., { timeout: 5000 })`.',
      },
      {
        sender: 'Macbeth',
        text: 'Hotfix verified in prod! Let us add a database connection pool alert to Datadog so we catch idle transactions after 15s.',
      },
    ],
  },

  // 3. Security Audit & OAuth Token Rotation
  {
    sender: 'Naeemudheen',
    text: '<@U0BPVPEUJ4U> SOC2 compliance auditor requested that all Slack OAuth bot tokens and user refresh tokens be encrypted at rest using AES-256-GCM in the database.\n\nRight now `slackAccessToken` is stored in plaintext in the `users` table.',
    replies: [
      {
        sender: 'Macbeth',
        text: 'On it! I will implement an encryption transformer in Prisma Middleware:\n\n```typescript\nimport { createCipheriv, createDecipheriv, randomBytes } from \'crypto\';\n\nexport function encryptToken(text: string): string {\n  const iv = randomBytes(16);\n  const cipher = createCipheriv(\'aes-256-gcm\', Buffer.from(process.env.ENCRYPTION_KEY, \'hex\'), iv);\n  let encrypted = cipher.update(text, \'utf8\', \'hex\');\n  encrypted += cipher.final(\'hex\');\n  return `${iv.toString(\'hex\')}:${cipher.getAuthTag().toString(\'hex\')}:${encrypted}`;\n}\n```',
      },
      {
        sender: 'Naeemudheen',
        text: 'Looks super clean! Make sure we write a migration script to encrypt all existing tokens in production before turning on the middleware.',
      },
      {
        sender: 'Macbeth',
        text: 'Migration script written and tested against staging backup. Will run migration tonight at 2 AM UTC during maintenance window.',
      },
    ],
  },

  // 4. Feature Flag & Enterprise RBAC Integration
  {
    sender: 'Macbeth',
    text: '<@U0BGWSH1ZMJ> enterprise customer ACME Corp requested custom Role-Based Access Control (RBAC) for their 5,000 users (`Admin`, `Editor`, `Viewer`, `AuditOnly`).\n\nShould we use LaunchDarkly or build an internal permission gate service?',
    replies: [
      {
        sender: 'Naeemudheen',
        text: 'Let us build a light `@Roles()` decorator and `RolesGuard` in NestJS backed by Redis cache for fast policy evaluation (<1ms overhead).\n\n```typescript\n@SetMetadata(\'roles\', roles)\nexport const Roles = (...roles: Role[]) => useCustomRoles(roles);\n```',
      },
      {
        sender: 'Macbeth',
        text: 'Love it! I will design the database schema for `roles`, `permissions`, and `user_roles` with foreign keys and index on `(userId, roleId)`.',
      },
      {
        sender: 'Naeemudheen',
        text: 'Awesome. I will take care of the NestJS execution guard and cache invalidation on role changes.',
      },
    ],
  },

  // 5. Code Review: Real-time LLM Streaming API
  {
    sender: 'Naeemudheen',
    text: '<@U0BPVPEUJ4U> I submitted PR #215 for the real-time AI Agent streaming response endpoint using Server-Sent Events (SSE).\n\nCan you review the event handler & token consumption logic when you get a chance?',
    replies: [
      {
        sender: 'Macbeth',
        text: 'Reviewing PR #215 now! The SSE response formatting looks great:\n```typescript\nres.setHeader(\'Content-Type\', \'text/event-stream\');\nres.setHeader(\'Cache-Control\', \'no-cache\');\nres.setHeader(\'Connection\', \'keep-alive\');\n```\nOne question: what happens if the client disconnects halfway through the LLM completion generation?',
      },
      {
        sender: 'Naeemudheen',
        text: 'Good spot! Added `req.on(\'close\', () => abortController.abort())` so we immediately cancel the upstream Anthropic/Gemini API call and save token costs.',
      },
      {
        sender: 'Macbeth',
        text: 'Approved & Merged PR #215! 🚀',
      },
    ],
  },

  // 6. Sprint Planning & Release Readiness
  {
    sender: 'Macbeth',
    text: 'Sprint 42 retrospective & release checklist:\n- [x] Vector search latency fix (<50ms)\n- [x] Slack OAuth token encryption (AES-256)\n- [x] SSE Agent streaming response\n- [ ] macOS companion app menu bar global hotkey\n- [ ] Multi-tenant workspace data isolation audit\n\n<@U0BGWSH1ZMJ> are we good for staging release tomorrow at 10 AM?',
    replies: [
      {
        sender: 'Naeemudheen',
        text: 'Yes! The macOS companion app menu bar hotkey `Cmd+Shift+I` is fully implemented and tested across macOS Sequoia & Sonoma.\n\nI will complete the multi-tenant data isolation test suite by end of day.',
      },
      {
        sender: 'Macbeth',
        text: 'Perfect! I will notify the QA team to trigger end-to-end regression tests on the staging build.',
      },
    ],
  },
];

async function slackPostMessage(token: string, channel: string, text: string, threadTs?: string) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
      mrkdwn: true,
    }),
  });
  return res.json();
}

async function main() {
  let token = process.argv.includes('--token')
    ? process.argv[process.argv.indexOf('--token') + 1]
    : process.env.SLACK_BOT_TOKEN;

  if (!token) {
    const dbUser = await prisma.users.findFirst({
      where: { slackAccessToken: { not: null } },
    });

    if (dbUser && dbUser.slackAccessToken) {
      token = dbUser.slackAccessToken;
      console.log(`🔑 Using Slack Access Token from DB user ${dbUser.email}...`);
    }
  }

  if (!token) {
    console.error('❌ Error: No Slack API Token found!');
    process.exit(1);
  }

  console.log('🚀 Simulating Large Enterprise Project Conversations between Naeemudheen & Macbeth on Slack...\n');

  const NAEEM_USER_ID = 'U0BGWSH1ZMJ';
  const MACBETH_USER_ID = 'U0BPVPEUJ4U';

  const targetChannels: string[] = [];

  // DM with Naeemudheen
  const dm1 = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ users: NAEEM_USER_ID }),
  }).then((r) => r.json());

  if (dm1.channel?.id) targetChannels.push(dm1.channel.id);

  // DM with Macbeth
  const dm2 = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ users: MACBETH_USER_ID }),
  }).then((r) => r.json());

  if (dm2.channel?.id) targetChannels.push(dm2.channel.id);

  if (targetChannels.length === 0) {
    console.error('❌ Could not open target Slack DM channels.');
    process.exit(1);
  }

  let totalPosted = 0;

  for (const item of LARGE_PROJECT_CONVERSATIONS) {
    const channelId = item.sender === 'Macbeth' ? targetChannels[0] : (targetChannels[1] || targetChannels[0]);
    console.log(`\n🏗️ [PROJECT DISCUSSION] Initiated by ${item.sender}...`);

    const formattedMainText = `*[${item.sender}]*\n${item.text}`;
    const mainRes = await slackPostMessage(token, channelId, formattedMainText);

    if (mainRes.ok && mainRes.ts) {
      totalPosted++;
      console.log(`  ✓ Main message posted (ts: ${mainRes.ts})`);

      if (item.replies) {
        for (const reply of item.replies) {
          const replyText = `*[${reply.sender}]*\n${reply.text}`;
          const replyRes = await slackPostMessage(token, channelId, replyText, mainRes.ts);
          if (replyRes.ok) {
            totalPosted++;
            console.log(`    ↳ Reply posted by ${reply.sender}`);
          }
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    } else {
      console.warn(`  ⚠️ Post error:`, mainRes.error || mainRes);
    }
  }

  console.log(`\n🎉 Successfully posted ${totalPosted} large project messages and replies to Slack!`);
}

main()
  .catch((err) => {
    console.error('Error simulating project conversations:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
