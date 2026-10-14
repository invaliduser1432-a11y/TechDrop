# Security and operational boundaries

## Administration

Deployed routes independently validate a Cloudflare Access RS256 JWT against the team's HTTPS JWKS, issuer, configured application audience and exact administrator email allowlist. Trust is never granted merely because a header exists. Access must protect both `/admin*` and `/api/admin/*`. Configure one Access audience covering both patterns. No valid configuration/token means no admin operations.

Local development login requires localhost, Astro development mode, demo mode, `ALLOW_LOCAL_ADMIN=true`, and a random configured token of at least 32 characters. Token comparison uses equal-size SHA-256 digests. The signed HS256 session expires in eight hours and uses HttpOnly, SameSite=Strict and Secure on HTTPS. This bypass is disabled in production builds and on non-loopback URLs. Local tokens are ignored by Git and excluded from deliverables. Access sign-out/revocation is managed by Cloudflare; the local Sign out button clears only the development cookie.

Mutations require exact same-origin and a session-bound CSRF header. Admin requests and local login attempts use database-backed rate-limit buckets. Input actions/settings/feeds are validated with Zod, queries bind SQL parameters, and dangerous destinations fail HTTPS/host/credential/port checks. Providers are never arbitrary browser-supplied fetch URLs. Dynamic text uses Astro escaping; serialized inline JSON escapes `<`.

## Secrets and logs

Provider credentials live in Worker secrets or local ignored `.dev.vars`; no token is returned through admin APIs or embedded in UI. Integration status reveals only configuration presence. Raw provider failures are converted to bounded operational codes so credentials or response bodies cannot appear in logs. Audit events record actor/action/target, never secret request bodies. Authentication failures are generic and fail closed.

Before publishing, set production HTTPS SITE_URL and real D1 bindings. Keep website and Cron mode/publishing gate aligned. Configure administrator email allowlists and exact authorized feed hosts. Review generated deploy configurations for your account before running remote commands.

## Browser protections

Responses set MIME-sniff prevention, frame denial, referrer policy, permission policy and HTTPS HSTS. The CSP limits sources, frames, forms and connections. It currently permits inline scripts/styles because Astro theme/JSON islands and Recharts require them. This is an explicit MVP tradeoff; a nonce/hash-based CSP is recommended before higher-risk extensibility or untrusted rich HTML. No HTML editor, third-party ad code or arbitrary script injection is present. Security headers for static assets should also be managed in your Cloudflare deployment; app middleware protects rendered responses.

No credentials are embedded in retailer destinations. Outbound links are visible and direct with sponsored/noopener/noreferrer; analytics run separately. There is no open redirect endpoint. Imported image permissions are an administrator assertion, not legal verification; use only licensed assets under the source's terms.

## Data and failure handling

History is scoped to listing and identity; timestamps and currency are checked before scoring. Production import refuses demonstration/mock sources. Demo routes are noindex and production queries exclude demo records. Shipping unknown, sparse history, expired stock, stale checks and uncertain seller information are handled conservatively. There are no fabricated reviews.

Durable locks and unique keys protect normal retries. Remote creation is not transactionally atomic with D1: ambiguous outcomes quarantine a job for reconciliation. No automatic action can guarantee recall of an external request already sent. Stop also requires pausing an already populated Buffer channel.

Click events contain deal, retailer, source and time only. Minute-salted address hashes are transient abuse buckets, purged during monitoring maintenance once older than ten minutes; no IP address enters analytics. Clicks expire after 90 days, error/job logs after 30 days, audits after 180. Administrator actions include independently verified commission records; these are not inferred from click counts.

## Before launch

Use your authorized environment to validate Access signatures/allow policies, eBay production access and OAuth renewal, retailer identity/stock/shipping fields, affiliate permissions and one reviewed Buffer draft-to-scheduled flow. Mocks do not prove account authorization or remote delivery. Observe Worker CPU and D1 usage, set budgets, and plan evidence-aware observation rollups/backup as the catalog grows. Consult the official current program/platform terms for eligibility and age/legal-capacity restrictions; do not bypass them.
