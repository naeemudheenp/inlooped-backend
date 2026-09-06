import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const entries = [
  {
    id: '047288a5-bf30-452c-bc00-1ef0d6aa8c17',
    day: new Date('2026-08-29T00:00:00.000Z'),
    body: `### Your Day — August 29

**Worked on**
* Investigated metadata reflection issue on the mobile app product page. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D09KRA9CS4E/p1787897749887959)
* Coordinated restaging of merged changes for desk settings. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D07T13KBU76/p1787922266453849)
* Discussed metadata handling logic for global page and mobile/product slugs. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04ME2W544V/p1787929247449349)

**Decisions**
* Agreed to accept Sonar issues to bypass break on chatbot backend PR. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04N6DB7BHS/p1787888484496259)

**Completed**
* Fixed frontend issue and got PR #445 approved. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BDC0TM2R/p1787894659568129)
* Created and resolved Help Center bug tickets SDE-5043, SDE-5001, and SDE-5044. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04ME2W544V/p1787920384845259)
* Resolved build access issue on WebsiteDeployment job. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D089T0L2QRJ/p1787893346440469)
* Fixed and deployed v36 release updates. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04N6DB7BHS/p1787921535085589)`,
    createdAt: new Date('2026-08-29T18:00:33.426Z')
  },
  {
    id: '0651ec77-fe55-4f24-b0ac-8f0d9ad3b743',
    day: new Date('2026-08-24T00:00:00.000Z'),
    body: `### Your Day — August 24

**Worked on**
* Clarified inquiry regarding PostHog SDK integration [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BDC0TM2R/p1787466246916759)

**Completed**
* Requested and obtained approval for Slack app installation [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04MULH8A5P/p1787494538609949)`,
    createdAt: new Date('2026-08-24T06:30:43.685Z')
  },
  {
    id: '14cb03c4-7647-467c-8b93-f59dedaf9da5',
    day: new Date('2026-09-05T00:00:00.000Z'),
    body: `### Your Day — September 5

* Sync attempted, but LLM service was temporarily unavailable. Custom work items were not extracted.`,
    createdAt: new Date('2026-09-05T18:00:26.405Z')
  },
  {
    id: '2cb3f519-db8a-43ad-ac4f-2ea9d085f4af',
    day: new Date('2026-09-04T00:00:00.000Z'),
    body: `### Your Day — September 4

**Worked on**
* Fixed Helpcenter pre-production deployment error by updating Japanese translations. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D09AWD2L804/p1788425379384739)
* Designed Liquid template parsing architecture for Helpcenter themes. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1788412362254519)

**Decisions**
* Agreed to build a POC using html-react-parser to render custom React components from Liquid output. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1788412362254519)

**Follow-ups**
* Complete integration testing for release v37.0 and update ticket status to Ready for Regression. [View in Slack →](https://app.slack.com/client/T3RDEGA00/C0BTLQ6MY11/p1788425100660189)
* Build a POC for Liquid template theme rendering. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1788412362254519)`,
    createdAt: new Date('2026-09-04T09:47:56.790Z')
  },
  {
    id: '43279aff-8521-43ad-a787-89e5ae8d316d',
    day: new Date('2026-09-01T00:00:00.000Z'),
    body: `### Your Day — September 1

**Worked on**
* Worked on help center Liquid theme implementation (SDE-5036/5038) [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04M0LGAAG7/p1788157737840299)
* Researched dynamic OG image implementation using Next.js metadata [View in Slack →](https://app.slack.com/client/T3RDEGA00/C0BN8H7A4Q3/p1788158444978259)
* Verified SEO details addition for mobile page [View in Slack →](https://app.slack.com/client/T3RDEGA00/D09KRA9CS4E/p1788166891397149)

**Completed**
* Triggered website deployment pipeline after PR merge [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04M286D1NK/p1788167038902419)`,
    createdAt: new Date('2026-09-01T09:55:30.819Z')
  },
  {
    id: '5abaaaae-cd22-47cb-b27e-70d535c599dc',
    day: new Date('2026-08-31T00:00:00.000Z'),
    body: `### Your Day — August 31

No Slack activity found for this day.`,
    createdAt: new Date('2026-08-31T18:00:03.209Z')
  },
  {
    id: '76198a44-45ea-42c4-be82-25e0f6c8fff7',
    day: new Date('2026-08-26T00:00:00.000Z'),
    body: `### Your Day — August 26

**Worked on**
* Published Chat Widget Config API CDN caching results showing a 99.62% origin request reduction. [View in Slack →](https://app.slack.com/client/T3RDEGA00/C07C7CQ2TGF/p1787656321007409)
* Submitted pull requests for backend and helpcenter repositories. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1787647608639959)
* Verified default configuration fallback behavior for helpdesk application. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D07T13KBU76/p1787646811061919)

**Decisions**
* Deferred Twigs component level updates to next week. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04N6DB7BHS/p1787644685181019)

**Completed**
* Reviewed and approved pull request #512 for sd-app-backend. [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04ME2W544V/p1787643038736289)`,
    createdAt: new Date('2026-08-26T05:42:33.749Z')
  },
  {
    id: '8c7fccd2-772f-4fd5-9c01-dceef3274d80',
    day: new Date('2026-08-27T00:00:00.000Z'),
    body: `### Your Day — August 27

**Worked on**
* Clarified chat widget config API functionality and discussed the dual-write migration strategy from DynamoDB to PostgreSQL [View in Slack →](https://app.slack.com/client/T3RDEGA00/D091MRH2D7Y/p1787718025448799)
* Assessed whether deferring participant registration and analytics data impacts proactive messaging [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1787718356454429)

**Decisions**
* Agreed to refactor message creation to use a common function in an upcoming release [View in Slack →](https://app.slack.com/client/T3RDEGA00/D07T13KBU76/p1787734891118699)`,
    createdAt: new Date('2026-08-27T12:01:59.787Z')
  },
  {
    id: '997804e6-df3d-488a-af55-246f88644329',
    day: new Date('2026-08-28T00:00:00.000Z'),
    body: `### Your Day — August 28

* Sync attempted, but LLM service was temporarily unavailable. Custom work items were not extracted.`,
    createdAt: new Date('2026-08-28T08:52:28.429Z')
  },
  {
    id: 'b651839d-4992-4659-9e0c-2c0e129f3eab',
    day: new Date('2026-08-25T00:00:00.000Z'),
    body: `### Your Day — August 25

**Worked on**
* Finalized CDN caching design for Help Center API responses [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1787560400982899)
* Created staging configuration PR for environment setup [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1787570443759089)
* Assisted teammate with Help Center bug troubleshooting [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04ME2W544V/p1787561564820679)

**Decisions**
* Centralize CDN cache purging within helpdesk-application upon article updates [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1787564394590239)

**Follow-ups**
* Inspect Twigs search input close button positioning in RTL mode [View in Slack →](https://app.slack.com/client/T3RDEGA00/C0AHK516600/p1787587793778509)`,
    createdAt: new Date('2026-08-25T09:39:58.657Z')
  },
  {
    id: 'bb8e89e8-b917-47b3-9266-8601b1d9c723',
    day: new Date('2026-08-23T00:00:00.000Z'),
    body: `### Your Day — August 23

**Worked on**
* Clarified sending events to PostHog instead of Sentry [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BDC0TM2R/p1787405659117189)`,
    createdAt: new Date('2026-08-23T14:14:28.782Z')
  },
  {
    id: 'ccc40037-84e9-4fcc-a791-9ed718431351',
    day: new Date('2026-08-20T00:00:00.000Z'),
    body: `### Your Day — August 20

No Slack activity found for this day.`,
    createdAt: new Date('2026-08-23T14:13:38.582Z')
  },
  {
    id: 'd4f1e355-f161-49f5-8c60-51bb979c8c15',
    day: new Date('2026-09-02T00:00:00.000Z'),
    body: `### Your Day — September 2

* Sync attempted, but LLM service was temporarily unavailable. Custom work items were not extracted.`,
    createdAt: new Date('2026-09-02T03:41:23.431Z')
  },
  {
    id: 'eafddd6d-d9f7-42af-b587-b55a1babdf42',
    day: new Date('2026-08-30T00:00:00.000Z'),
    body: `### Your Day — August 30

**Worked on**
* Inquired about billing page issues [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08ENV6JL03/p1787991372078099)

**Follow-ups**
* Perform production sanity check for release v36.0 [View in Slack →](https://app.slack.com/client/T3RDEGA00/C0BSA7K8VEV/p1788002928451139)`,
    createdAt: new Date('2026-08-29T18:32:14.667Z')
  },
  {
    id: 'f3501563-5bc5-42cf-be8f-366aec01889d',
    day: new Date('2026-09-03T00:00:00.000Z'),
    body: `### Your Day — September 3

**Worked on**
* Clarified multi-lingual chat widget auto-language detection and shared preview demo [View in Slack →](https://app.slack.com/client/T3RDEGA00/D04M286D1NK/p1788353335205589)
* Coordinated package dependency cleanup for helpdesk-backend package.json [View in Slack →](https://app.slack.com/client/T3RDEGA00/D065DTF2V70/p1788348158194649)

**Completed**
* Created Jira ticket SDE-5057 for sd-app-frontend PR release [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08BU34N2SD/p1788329862726979)
* Reviewed PRs for subscription status middleware in chat widget and chatbot backend [View in Slack →](https://app.slack.com/client/T3RDEGA00/D08N4SGS266/p1788342695874699)`,
    createdAt: new Date('2026-09-03T04:37:39.438Z')
  }
];

async function main() {
  const users = await prisma.users.findMany();
  if (users.length === 0) {
    console.error('No users found in database! Run prisma db seed first.');
    process.exit(1);
  }

  for (const user of users) {
    console.log(`Seeding journal entries for user ID: ${user.id} (${user.email})`);
    for (const entry of entries) {
      await prisma.journalEntry.upsert({
        where: {
          userId_day: {
            userId: user.id,
            day: entry.day
          }
        },
        update: {
          body: entry.body,
          updatedAt: new Date()
        },
        create: {
          id: entry.id,
          userId: user.id,
          day: entry.day,
          body: entry.body,
          createdAt: entry.createdAt
        }
      });
    }
  }

  console.log('Successfully seeded all 15 journal entries into local DB!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
