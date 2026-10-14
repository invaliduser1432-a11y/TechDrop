# Setup and operating guide

## 1. Install and initialize

Node 24+ is required. Work in the project folder:

```sh
npm ci
npm run db:migrate
npm run demo:seed
npm run dev
```

Visit `http://localhost:4321`. This uses Cloudflare's local emulator and D1; it needs no paid account. Seeding creates 16 fictional listings across 14 categories, a meaningful simulated history, a $125 → $89 SSD example, review candidates, an unavailable expired offer and a listing with insufficient history. Original SVG illustrations are included. The seed command is local-only and can be repeated to refresh timestamps. It never writes a remote database.

The ignored `.dev.vars` file receives a random admin token if absent. Inspect that file privately and enter its value at `/admin/login`. Do not share it. `.env.example` documents the server variables; Workers use `.dev.vars` for local secrets. If copying the example manually, generate a token of at least 32 random characters. Do not overwrite an existing token with a blank value.

## 2. Exercise the complete demo

1. Search for Atlas, open the SSD page and inspect the recorded observations and chart.
2. Open `/admin`. Inspect a review candidate's history, approve it, feature it or reject it.
3. Recheck a listing or run monitoring. The mock provider refreshes its current fixture price; history and qualification use real persisted demo records. Unit tests exercise price reductions and availability transitions; the seed fixture includes the before/after history.
4. Create a local draft from an approved deal. With publishing disabled, this does **not** contact Buffer.
5. Choose Manual approval, select `demo-org` and `demo-x`, save settings, approve a draft, then Process social queue. `demo-queued` is a simulation, never a real published post. Automatic mode also simulates in demo.
6. Stop everything pauses monitoring and new publishing. Re-enable monitoring in settings when ready. Publishing stays disabled until intentionally changed.

## 3. Verify

```sh
npm run check
npm run lint
npm test
npm run build
# With the local dev server running:
npm run test:e2e
```

Browser tests require Chromium. The supplied environment has system Chromium; elsewhere use `npx playwright install chromium`. E2E resets known demo fixtures and exercises approval/drafts; do not run it against a production database. SQLite-backed unit tests use an isolated in-memory database with the actual migration. Local D1 migration and SSR/E2E tests separately exercise Cloudflare's emulator.

## 4. Authorized retailer inputs

Production mode must be set explicitly in both Wrangler files. Configure approved API access and server secrets as described in DEPLOYMENT.md. No demo record becomes real when you flip mode: production queries exclude demo data and imports refuse mock providers.

File feeds must be authorized for your use. Set `FEED_HOSTS` to the retailer's exact approved hosts, create that retailer in Sources & categories, then paste its JSON or CSV feed and confirm authorization. Images are accepted only when the permission flag is true and the URL belongs to an approved host. Third-party image/CDN support requires adding the exact authorized host and complying with its license.

JSON format (prices are **integer cents**, not dollars):

```json
[
  {
    "externalId": "AUTHORIZED_LISTING_ID",
    "name": "Exact listing title",
    "brand": "Actual brand",
    "model": "Exact model",
    "variant": "2TB / black / exact SKU",
    "category": "storage",
    "condition": "new",
    "currency": "USD",
    "price": 8900,
    "shipping": 0,
    "originalUrl": "https://APPROVED_RETAILER_HOST/item",
    "available": true,
    "imagePermitted": false
  }
]
```

Replace every placeholder with authorized data. Optional `affiliateUrl` and `imageUrl` must pass the retailer host validation. Unknown shipping is null; it cannot qualify a major price drop. CSV uses the same header names, standard quoted fields and booleans `true`/`false`. Each upload is limited to 1 MB and 100 rows. No client-supplied historical timestamps or suggested original prices are imported. History starts with observations made here. Changed model, variant, condition or currency needs a new listing identity, never an update to old history.

For eBay, obtain approved production Browse access. Set `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` for automatic client-credentials application-token renewal, or supply a valid `EBAY_ACCESS_TOKEN` override and rotate it before expiry. Import exact eBay metadata with the eBay retailer/provider selected. Each listing is fetched before saving; the external ID must be the Browse API `itemId`, not an assumed numeric legacy item number. The title and condition must match the fetched listing. Currency must be USD. Enable eBay in Providers to monitor those listings. The adapter refuses identity changes and treats absent stock evidence conservatively. This code does not confer production API approval.

Uploaded file feeds receive fresh observations only on the next import. They are not remotely scraped. Future integrations implement `ProductProvider.refresh` and honor `minIntervalMs`; register the adapter in monitoring and the provider row.

## 5. Automation

The Cron Worker runs every 30 minutes. Settings can select a longer monitoring interval, a maximum batch of 20 and the enabled providers/categories. To test a scheduled event locally, with the website stopped if needed:

```sh
npm run jobs:dev
# In another terminal, use the printed port (normally 8787):
curl 'http://localhost:8787/__scheduled?cron=*/30+*+*+*+*'
```

Both local Workers must use the same `.wrangler/state` directory. The jobs Worker must receive the same provider/Buffer secrets and deployment mode. For production, deploy it separately, then enable monitoring in admin. Enabling Automatic website approval allows the monitor to publish qualified deals to the website without manual review; default is off.

For real automatic social posting, follow BUFFER_SETUP.md, deliberately set the server publishing gate, verify the authorized X channel and account eligibility, save Automatic mode and thresholds. No real request is made in demo mode. Disabled mode sends nothing to Buffer. Manual mode requires local draft approval before a remote draft and scheduling request are made.

## 6. Immediate pause

Click **Stop everything** in admin: it disables monitoring and publishing and cancels unsent jobs. Pause your channel in Buffer as well to stop posts already scheduled there. Disable the Cron Trigger or deploy jobs with no triggers if you need to stop invocations entirely. Set `LIVE_PUBLISHING_ALLOWED=false` on both Workers for an additional server-side publishing gate. An already in-flight external request cannot be recalled by local settings.
