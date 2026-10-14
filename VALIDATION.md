# Validation results

Verified locally on October 14, 2026 using Node 24 and Cloudflare's local runtime:

| Check | Result |
| --- | --- |
| Astro diagnostics + TypeScript no-emit | Passed: 0 errors, 0 warnings, 0 hints |
| ESLint | Passed |
| Vitest unit/integration tests | 32 passed across 3 files |
| Playwright Chromium E2E | 5 passed |
| Cloudflare D1 migrations | Both migrations applied successfully locally |
| Demonstration import | 16 fictional listings with persisted history, review/expired/insufficient-history cases |
| Astro production build | Passed |
| Cron Worker deployment packaging | Wrangler --dry-run passed; no deployment performed |
| Built website runtime | HTTP 200 in local Wrangler preview |
| Built React chart | Hydrated and rendered in Chromium with no page errors |
| Built local admin bypass | Rejected with HTTP 403 |
| Expired/unknown URLs | 410 for known expired offer; 404 for unknown deal/page/category |

The unit suite covers the $125 → $89 historical example, ordinary fluctuation, misleading original prices, insufficient/sparse/future history, shipping, availability, freshness, listing/variant/currency identity, duplicate detection, database constraints, provider retries, admin authentication/tampering/CSRF, unsafe affiliate destinations, CSV/JSON importing, eBay failure handling and OAuth token reuse, Buffer GraphQL payloads/failures/rate-limit pause/uncertain outcomes, disabled-mode transport blocking, simulated idempotency, automatic website approval, schedule caps/spacing and cancellation of an expired queued offer.

Browser tests cover public SSR content, labeled demo data, search/category/budget filters, chart ranges, theme persistence, mobile overflow, status codes, anonymous admin blocking, CSRF, settings persistence, candidate approval, local post generation, simulated queue processing, monitoring and emergency stop.

No real retailer, affiliate, Buffer, X account, Access tenant or remote Cloudflare deployment was tested. Approved external access and an account-specific integration test remain prerequisites to launch. No paid resource or real social publishing was activated.
