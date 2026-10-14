# Buffer and X publishing

The adapter was implemented against the official [Buffer Quick Start](https://developers.buffer.com/guides/getting-started.html), [first post guide](https://developers.buffer.com/guides/your-first-post.html) and [GraphQL reference](https://developers.buffer.com/reference.html), reviewed October 14, 2026. The endpoint is `https://api.buffer.com` with server-side Bearer authentication. Live requests have not been tested because no authorized credential/account was supplied.

## Connect safely

1. Obtain an API key from your authorized Buffer account. Connect an eligible X account through Buffer's official flow. Confirm the API, plan, channel permissions, X publishing access, age/legal-capacity and program requirements in current official terms. Never use inaccurate account information or login automation.
2. Set `BUFFER_TOKEN` as a secret on both website and jobs Workers. Do not enter the token in a browser, commit it, or expose it in a PUBLIC_ variable.
3. In admin, **Check Buffer channels** retrieves your organizations. Copy the intended organization ID into settings. In disabled mode you cannot save a live publishing mode without its configured gates, but you can save IDs while still disabled.
4. Save organization ID with publishing still Disabled, then check channels again. Copy the ID of the intended `service: twitter` channel. The server rejects disconnected, locked, paused, missing and non-X channels before activation/submission.
5. Confirm authorized eligible account ownership, choose conservative thresholds, and set `LIVE_PUBLISHING_ALLOWED=true` only when you deliberately intend to send real posts. Select Manual approval first and save. The activation check fetches channel state; it does not publish a post.
6. Approve a current deal for the website, generate a local social draft, inspect it, approve it, and process the queue. A remote Buffer draft is created and its ID stored before scheduling that existing post. Default schedule limits are three posts/day, three-hour spacing and score ≥85.
7. Inspect Buffer and use Refresh status on the job to reconcile actual delivery. `queued` is not `sent`. Once verified, you may deliberately choose Automatic mode. It picks approved active deals above the configured threshold. Enable automatic website approval separately if you want qualified deal candidates to bypass manual website review.

## Supported documented operations

- `account { organizations { id name } }`
- `channels(input: ChannelsInput!)`, with organization ID and connected-channel fields.
- `createPost(input: CreatePostInput!)`, including channel, text, empty assets, `needsApproval: false`, automatic scheduling, `saveToDraft: true`.
- `editPost(input: EditPostInput!)`, referencing the persisted ID with `mode: customScheduled`, explicit `dueAt`, `saveToDraft: false`.
- `post(input: PostInput!)`, with **id only**, retrieving status, dueAt and sentAt.

Success and mutation error unions are handled without exposing raw provider errors. Generated ASCII promotional text uses verified stored totals, savings, #ad and the website URL. X's 280-character budget counts the URL as 23 characters; text is conservatively limited. No browser-based X posting is implemented.

## Modes and recovery

Disabled sends no publishing request. It still permits explicit read-only connection checks and local text generation. Manual sends only approved drafts. Automatic requires intentional admin configuration, eligibility confirmation, a verified channel, server credential and server publishing gate. Demo always simulates and never contacts Buffer for publishing.

Rate-limit rejection persists cooldown and retry time; authorization failure disables publishing. Uncertain mutations are held for reconciliation instead of resending. A job whose remote ID is unknown must be inspected in Buffer before any recovery; there is no automatic “retry anyway” control. Posted history uses actual retrieved status, not a claim that queue acceptance means delivery.

**Stop everything** prevents new monitoring/submissions and cancels unsent jobs. It does not cancel posts already scheduled in Buffer or recall an in-flight request. Pause the channel in Buffer immediately too. For an additional gate, set `LIVE_PUBLISHING_ALLOWED=false` on both Workers. Leave mode Disabled whenever performing integration maintenance.

The active Cron publishing engine polls up to three queued posts per run, records actual sent/error status, and moves unsent invalid or expired offers back to Buffer drafts. This requires publishing to remain enabled and authorized. Price/stock can still change between checks or while a post is already sending; disable/pause the channel when intervening immediately.
