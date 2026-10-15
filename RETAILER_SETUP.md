# Amazon and Best Buy connections

The code now supports automatic official-API searches and exact-product watchlists, website review/automatic publication, and approved affiliate destinations. No retailer account was created, no live API credential was supplied, and no remote deployment or real social publishing was performed for this change.

## What these integrations publish

`/offers` shows fresh, in-stock, new-condition US product offers in USD, with a check timestamp, shipping information when supplied, and a direct retailer link. It never claims a historical discount from a retailer's crossed-out price. Search queries and ASIN/SKU watchlists are separate from the historical catalog.

API content lives in a replaceable cache for at most one hour. Refresh removes unavailable/restricted products; expired content is hidden immediately and deleted by the next Cron run, including when monitoring is paused. Keep Cron running for cleanup. Review backup/export retention for cached retailer content; do not archive this table. No images are downloaded or product image URLs retained. Best Buy's supplied developer logo is referenced directly for attribution.

The existing verified-deal feed and Buffer queue still use authorized historical observations. These retailer API offers never enter either one. An independently licensed history source and a corresponding integration are needed before these retailers can support verified historical price-drop alerts. Merely setting an approval flag does not add that functionality.

## Amazon US

Amazon's current Associates policies require its agreement to use content on a site with price tracking. Obtain that agreement for DealRadar before activation. A Creators API credential alone is insufficient. The adapter keeps no Amazon price history.

Use approved **Creators API OAuth credentials, version 3.1 (North America)**, plus your actual approved US Associates tracking tag. Old PA-API access/secret keys are incompatible. Other regions are not implemented.

Configure these server values on **both** website and jobs workers:

| Variable                         | Value                                                      |
| -------------------------------- | ---------------------------------------------------------- |
| `AMAZON_CREATORS_CLIENT_ID`      | Creators API credential ID                                 |
| `AMAZON_CREATORS_CLIENT_SECRET`  | Creators API secret                                        |
| `AMAZON_PARTNER_TAG`             | Your approved US tracking tag                              |
| `AMAZON_SITE_APPROVAL_REFERENCE` | Reference to Amazon's actual agreement for this site's use |

Store credentials with Cloudflare Worker secrets or your existing secure configuration workflow. Never commit them. For example, `npx wrangler secret put AMAZON_CREATORS_CLIENT_SECRET`, then repeat with `--config wrangler.jobs.jsonc`. Use the same method for the other server values if you prefer to keep them out of source.

The adapter authenticates at `api.amazon.com`, calls `creatorsapi.amazon`, and requests OffersV2. It accepts only the public new-condition Buy Box offer, validates ASIN and returned partner tag, suppresses MAP/member/subscription offers, and expires timed offers at their stated end. OffersV2 provides no delivery-cost field here, so shipping remains unknown. Returned savings/list-price fields never become historical evidence.

Official references checked October 15, 2026:

- [Creators API introduction](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/introduction)
- [OAuth and request examples](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl)
- [GetItems](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/get-items), [SearchItems](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items), [OffersV2](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/offersV2)
- [Associates policies](https://affiliate-program.amazon.com/help/operating/policies), participation requirement 6(y) and IP license

## Best Buy US

Obtain a Products API key and confirm the site's intended display/use meets Best Buy's API terms. Affiliate participation is separate: obtain acceptance into the Best Buy program through Impact and use the assigned partner ID.

| Variable                    | Value                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| `BESTBUY_API_KEY`           | Approved Products API key, as a server secret on both workers               |
| `BESTBUY_API_APPROVED`      | `true` only after confirming permitted site use                             |
| `BESTBUY_IMPACT_PARTNER_ID` | Optional actual approved numeric Impact partner ID                          |
| `BESTBUY_AFFILIATE_HOSTS`   | Optional comma-separated exact HTTPS hosts in your returned affiliate links |

The API request supplies `IPID` only when you configured your real partner ID. Affiliate URLs returned for that request must match the configured hosts. Without both affiliate settings, the adapter uses the ordinary Best Buy product URL, which does not earn commission. Invalid tracking hosts fail closed instead of creating a substitute affiliate link. Best Buy key-bearing request URLs and response error bodies are never logged.

The adapter requires an active, online-available, new-condition product, preserves its SKU, and displays `salePrice`. Unknown shipping stays unknown. Standard API caching is limited to temporary display use; this implementation uses the stricter one-hour cache and does not build history from it.

- [Products API documentation and affiliate URL parameters](https://bestbuyapis.github.io/api-documentation/)
- [API terms and branding rules](https://developer.bestbuy.com/legal)
- [Official affiliate program](https://www.bestbuy.com/site/misc/best-buy-affiliate-program/pcmcat198500050002.c?id=pcmcat198500050002)

## Upgrade the existing deployment

1. Pull `main`. The existing production D1 IDs, Access settings, canonical URL, and `APP_MODE=production` in both worker configurations are preserved. Review these values before deploying to a different account.
2. Apply the additive migration: `npx wrangler d1 migrations apply dealradar --remote`. This adds disabled providers, searches, and the temporary cache; it does not modify existing settings or historical data.
3. Configure only approved integrations on both workers, then build/deploy the website and jobs worker using [DEPLOYMENT.md](DEPLOYMENT.md). Keep `LIVE_PUBLISHING_ALLOWED=false` in both workers and social posting mode **Disabled**.
4. In protected admin → **Amazon & Best Buy**, add a keyword search and category, or up to 10 comma-separated ASINs / SKUs. Searches fetch the first ten results, not the entire retailer catalog. Multiple searches rotate across runs.
5. Enable the configured retailer under **Sources & categories**. Click **Collect retailer offers now** or wait for Cron. Unconfigured providers cannot be enabled. Authentication errors disable a provider; correct credentials, then enable it again.
6. Publish individual fresh offers, or select automatic website publication when adding a search. Check `/offers` and the target's last-check/error column. Automatic website publication does not enable social posting. Removing a search also removes its cached offers.

Each run makes at most one collection request per retailer (plus Amazon token acquisition), up to ten products each. Rate limits pause the provider, temporary errors back off, and a durable lock prevents overlapping collections. The monitoring interval still applies; an interval longer than the cache lifetime leaves gaps with no visible offers.

## Network domains

For runtime collection, allow `api.amazon.com`, `creatorsapi.amazon`, and `api.bestbuy.com`. The Best Buy attribution image uses `developer.bestbuy.com`. Retailer checkout links use `www.amazon.com`, `www.bestbuy.com`, and the exact affiliate hosts from your approved Best Buy API response; these destinations open in the visitor's browser.

For verifying this deployment from Codex, allow `dealradar.dealradar-1432.workers.dev` and the configured Access team `small-bush-b8c6.cloudflareaccess.com`. Deploying/configuring Cloudflare also needs `api.cloudflare.com`; any interactive identity-provider login needs its actual hostname. This environment currently has no retailer/Cloudflare credentials and its network policy does not allow these service domains, so live collection and deployment were not verified here.

## Suggested application description

> DealRadar is a technology shopping website. We plan to display current product offers from your official API, link customers directly to your product pages using our approved affiliate account, disclose commissions, and refresh or remove cached data promptly. We also have a separate historical-price feature using separately authorized sources. Please confirm the permissions and any additional agreement required for this use before we activate your integration.

Describe the site truthfully and obtain any required approval; this paragraph is a draft for your review, not an application submission or a claim of eligibility.
