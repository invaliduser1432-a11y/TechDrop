# DealRadar

A working technology deals MVP built with Astro 7, React, Tailwind 4, Cloudflare Workers and D1. Public content is server rendered. A separate Cron Worker monitors listings, calculates conservative historical discounts, and processes an idempotent Buffer publishing queue.

**Safe defaults:** clearly labeled fictional demonstration data, no indexing in demo mode, manual website approval, social publishing disabled, no fabricated affiliate IDs, no external account creation or live publishing performed.

## Run locally

Use Node 24+ and npm. From the project directory:

```sh
npm ci
npm run db:migrate
npm run demo:seed
npm run dev
```

Open **http://localhost:4321**. The local D1 database persists in `.wrangler/state`. Visit `/admin/login` and use the generated `LOCAL_ADMIN_TOKEN` from the ignored `.dev.vars` file. It is never printed, bundled into a client script, or shipped with the source archive. Local administration requires localhost, development mode, demo mode, and an intentionally configured token; deployed administration requires Cloudflare Access.

```sh
npm run check
npm run lint
npm test
npm run build
# Start npm run dev first, then:
npm run test:e2e
```

Playwright uses system Chromium if `/usr/bin/chromium` exists; otherwise install it with `npx playwright install chromium`. Browser tests mutate only your local demonstration workflow. The environment wrapper places tool caches/logs under `work/` instead of your home directory. Astro 7 may run dev as a background process: `node scripts/run.mjs astro dev stop` stops it.

## What works

- Responsive light/dark public website, eight discovery sections, search, filters, category pages, pagination and individual deal URLs.
- Interactive Recharts plus server-rendered observation tables, factual methodology, disclosures, canonical metadata, sitemap, robots, 404 and expired-offer 410 responses.
- D1 migrations, listings and identity-safe observations, 30-minute monitoring, provider cooldowns, backoff, stale/availability expiry, durable locks, audit events and retention.
- Mock provider, authorized CSV/JSON importer, eBay Browse refresh adapter with application OAuth-token renewal.
- Configurable score weights, category adjustments, evidence thresholds and optional automatic website approval.
- Direct approved affiliate links, anonymous event analytics and separately verified commission records.
- Official Buffer GraphQL adapter: organization/channel lookup, X channel validation, draft creation, scheduling persisted drafts, saved IDs, status reconciliation, rate-limit pause and uncertain-outcome quarantine.
- Private admin controls for approvals, featuring, rechecks, drafts, settings, categories, providers, imports, links, revenue, logs and emergency stop.

## Project structure

```text
src/
  components/           Astro cards/icons/browser; interactive React price chart
  layouts/              Shared site chrome and metadata
  pages/                Public SSR routes, admin pages, server APIs
  lib/
    affiliate/          Approved direct destination selection
    db/                 D1 repositories, audit logs, distributed locks
    jobs/               Monitoring engine and Cron Worker
    price/              History statistics and conservative scoring
    providers/          Interface, mock, eBay/OAuth, CSV/JSON import
    security/           Access JWT verification, local sessions, CSRF, throttles
    social/             Documented Buffer operations and durable publishing queue
    config.ts           Zod settings and defaults
    runtime.ts          Server environment validation
migrations/             Relational D1 schema and indexes
scripts/                Demo fixtures, seeding, portable tool wrapper
public/art/             Original SVG demonstration illustrations
 tests/                 Vitest SQLite-backed integration tests and Playwright E2E
wrangler.jsonc          Website Worker configuration
wrangler.jobs.jsonc     Cron Worker configuration
```

Read [SETUP.md](SETUP.md), [DEPLOYMENT.md](DEPLOYMENT.md), [ARCHITECTURE.md](ARCHITECTURE.md), [AFFILIATE_SETUP.md](AFFILIATE_SETUP.md), [BUFFER_SETUP.md](BUFFER_SETUP.md), and [SECURITY.md](SECURITY.md).

## Production limits

No real eBay, affiliate, Buffer, X, Cloudflare Access tenant, or remote Cloudflare deployment was exercised. External adapters were tested against mocks; D1 migrations and the UI were tested locally. Approved credentials, provider permissions, an Access application and actual database IDs are still needed.

File feeds record history on import; they have no invented polling endpoint. Automate delivery through your authorized importer or add a provider for a documented endpoint. eBay seeds exact listing identities from authorized feed metadata and then refreshes through Browse; it does not scrape or auto-crawl the marketplace. USD and known shipping are required for qualification. Unknown stock is treated conservatively.

The default batch of 10 is intended for a small catalog, not a guarantee that every listing in a large catalog is checked every 30 minutes. Size batches and cadence against measured provider/D1/Worker limits. Monitor capacity and errors; stale offers hide automatically. Free-plan CPU limits can require Workers Paid even for a small job. No paid plan or resource was activated here.

Ambiguous remote mutations require reconciliation, not blind retry. Stop prevents new submissions; it cannot undo an in-flight request or cancel posts already scheduled in Buffer. Pause that channel in Buffer too. A known persisted post can be refreshed in the admin dashboard. An unknown remote ID requires manual inspection before any recovery.

The active Cron publishing engine polls up to three queued posts per run, records actual sent/error status, and moves unsent invalid or expired offers back to Buffer drafts. This requires publishing to remain enabled and authorized. Price/stock can still change between checks or while a post is already sending; disable/pause the channel when intervening immediately.
