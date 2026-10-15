# Cloudflare deployment

The checked-in configs target the existing DealRadar production Workers and D1 database, with Cloudflare Access settings and social publishing disabled. This retailer-integration change does not deploy them or modify remote resources. The account-creation steps below are for a new installation; an existing installation should keep its actual IDs and apply only pending migrations before deployment.

## 1. Prepare an authorized Cloudflare account

Use truthful, eligible account information and review current Cloudflare, retailer, affiliate, Buffer and X terms. This project does not bypass account approvals, age restrictions or API access. Start with a `workers.dev` URL; you do not need to own a domain.

From your own authorized terminal:

```sh
npx wrangler login
npx wrangler d1 create dealradar
```

For a new installation, copy your actual database and account IDs into **both** `wrangler.jsonc` and `wrangler.jobs.jsonc`. The checked-in IDs belong to the existing production installation.

```sh
npx wrangler d1 migrations apply dealradar --remote
```

Do not run the demo seed against a remote production database. It is deliberately local-only. Keep a separate database/Worker name if hosting a demonstration deployment.

## 2. Configure runtime and authentication

Before exposing admin, create Cloudflare Access applications covering **both** `/admin*` and `/api/admin/*` on the intended hostname. Set an explicit allow policy for administrator identities. Keep the default Worker hostname protected as well, or disable unprotected alternative hostnames. Application code independently verifies the signed assertion and administrator email allowlist, so absent/misconfigured Access fails closed.

Set website non-secret variables in `wrangler.jsonc`:

- `APP_MODE`: `production`
- `SITE_URL`: your canonical HTTPS Worker URL
- `ALLOW_LOCAL_ADMIN`: `false`
- `LIVE_PUBLISHING_ALLOWED`: `false` initially
- `ACCESS_TEAM_DOMAIN`: your team hostname, e.g. `your-team.cloudflareaccess.com`
- `ACCESS_AUD`: the Access application's audience ID (the same app must cover both route patterns)
- `ADMIN_EMAILS`: comma-separated exact allowed email addresses
- `FEED_HOSTS`: comma-separated exact authorized retailer/image hosts

In `wrangler.jobs.jsonc`, use the **same** D1 ID, production mode, SITE_URL and initial publishing gate. Only the website needs Access variables; the jobs Worker has no public control endpoint.

Supply approved secrets interactively. Never include secret values as shell arguments or store them in source:

```sh
npx wrangler secret put EBAY_CLIENT_ID
npx wrangler secret put EBAY_CLIENT_SECRET
npx wrangler secret put BUFFER_TOKEN
npx wrangler secret put EBAY_CAMPAIGN_ID
# Configure the same integrations on the Cron Worker:
npx wrangler secret put EBAY_CLIENT_ID --config wrangler.jobs.jsonc
npx wrangler secret put EBAY_CLIENT_SECRET --config wrangler.jobs.jsonc
npx wrangler secret put BUFFER_TOKEN --config wrangler.jobs.jsonc
npx wrangler secret put EBAY_CAMPAIGN_ID --config wrangler.jobs.jsonc
```

Only supply secrets for approved integrations you intend to use. eBay campaign ID is optional and requires affiliate approval. OAuth client credentials are preferable for unattended monitoring; an `EBAY_ACCESS_TOKEN` secret can override them but expires and must be rotated. Neither a token nor app keys establish production Browse permission.

## 3. Validate and deploy

```sh
npm run check
npm run lint
npm test
npm run build
npm run deploy
npm run jobs:deploy
```

Astro's Cloudflare adapter builds its unified Worker entrypoint and emits `.wrangler/deploy/config.json`; Wrangler uses that built configuration. Do not replace the source entrypoint with a guessed `dist/server/entry.mjs`. Sessions and Cloudflare image transformations are disabled, so neither KV nor Images is automatically provisioned.

`npm run jobs:deploy` deploys the independent Cron Worker with the checked-in 30-minute trigger. Use the printed website URL and set it as SITE_URL in both configs if it differs, then redeploy. No domain purchase is required. Check Cloudflare Worker logs and the admin System Health page after the first Cron run.

## 4. Onboard real listings

For Amazon/Best Buy official API searches and watchlists, apply migration `0003_retailer_offers.sql` and follow [RETAILER_SETUP.md](RETAILER_SETUP.md). Configure the same credentials/approval gates on both workers. These sources populate `/offers` and never the historical price-drop or social queues. Keep the jobs Cron active for cache deletion even when monitoring is paused.

Authorize exact feed hosts, create retailer entries in admin, import legitimate data, and enable the appropriate providers/categories. New imports do not receive invented historical data; qualification requires actual subsequent observations across the configured evidence period. Optionally enable Automatic website approval once the policy is reviewed.

Follow AFFILIATE_SETUP.md and BUFFER_SETUP.md for program rules and publishing activation. Keep social mode Disabled while establishing monitoring. To activate intentionally, set `LIVE_PUBLISHING_ALLOWED=true` in both Worker configs, redeploy, confirm authorized eligibility/channel in admin and choose Manual or Automatic mode. Website auto-approval is a separate setting.

## Costs and capacity

The initial catalog, static illustrations and local tests incur no API or hosting spend. Workers/D1 support commercial applications; this project does not use a personal-only hosting tier. Free quotas are capacity limits, not a promise that a workload fits.

Official references checked October 14, 2026:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [pricing](https://developers.cloudflare.com/workers/platform/pricing/).
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [pricing](https://developers.cloudflare.com/d1/platform/pricing/).

D1 Free currently includes 5 million rows read/day, 100,000 rows written/day and 5 GB total storage, with a smaller per-database size cap than Paid. Indexes affect row-write usage. Workers Free currently limits requests and CPU; the free CPU allowance can be more restrictive than this catalog's request count. Cron trigger CPU limits depend on plan/cadence. Measure actual CPU, rows and execution time before assuming free operation. Buffer/X publishing availability, API access and plan limits depend on your authorized accounts; a supported free plan is not guaranteed to cover real X posting. No paid API subscription is required for the demo.

Default monitoring checks up to 10 due listings every half hour (at most 480 listing refreshes/day before rechecks). It logs unchanged observations to establish continuity. A catalog larger than the batch capacity will stretch intervals; monitor stale counts and increase capacity only within authorized rate/CPU limits. The maximum batch is 20. Public freshness gates hide offers that were not rechecked in time. Worker Paid, additional D1 capacity or a larger job architecture may be needed as traffic/history grow. Configure budgets and alerts on your account; nothing is upgraded automatically here.

## Pause and recover

Stop everything in admin disables monitoring and new publishing. Pause already scheduled posts directly in Buffer. Set the server gate false, remove Cron triggers if necessary, and inspect uncertain jobs before recovery. Expiring locks permit retry after a crashed Worker; completed scheduled run IDs and unique publication records prevent normal duplicates. Back up D1 before future migrations and use Cloudflare's backup/restore capabilities according to your plan.

No production deployment, Access-tenant login, real retailer pricing, affiliate conversion or actual Buffer/X delivery was verified in this session. Test those in your approved environment before launch.
