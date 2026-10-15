import type { Env } from '../types';
import { getSettings } from '../config';
import { lock, unlock, logError } from '../db/repository';
import { AmazonOffers } from '../providers/amazon';
import { BestBuyOffers } from '../providers/bestbuy';
import { ProviderError } from '../providers/interface';
import {
  retailerReadiness,
  targetSchema,
  validateOfferLink,
  type RetailerOffer,
  type RetailerProvider,
  type OfferTarget,
} from '../providers/retailer-offers';

export interface TargetRow {
  id: string;
  provider_id: RetailerProvider;
  mode: 'search' | 'items';
  query: string;
  category_id: string;
  auto_publish: number;
  enabled: number;
  next_check_at: number;
  failures: number;
  last_checked_at: number | null;
  last_error: string | null;
}
export interface CachedOffer {
  id: string;
  target_id: string;
  provider_id: RetailerProvider;
  payload: string;
  approved: number;
  fetched_at: number;
  expires_at: number;
}

export async function addRetailerTarget(env: Env, input: OfferTarget) {
  const value = targetSchema.parse(input);
  if (
    !(await env.DB.prepare('SELECT id FROM categories WHERE id=? AND enabled=1')
      .bind(value.category)
      .first())
  )
    throw new Error('Choose an enabled category');
  const count = await env.DB.prepare('SELECT COUNT(*) count FROM retailer_targets').first<{
    count: number;
  }>();
  if ((count?.count ?? 0) >= 50)
    throw new Error('Limit of 50 retailer searches / watchlists reached');
  await env.DB.prepare(
    `INSERT INTO retailer_targets(id,provider_id,mode,query,category_id,auto_publish) VALUES (?,?,?,?,?,?)`,
  )
    .bind(
      crypto.randomUUID(),
      value.provider,
      value.mode,
      value.query,
      value.category,
      +value.autoPublish,
    )
    .run();
}

export async function purgeRetailerOffers(env: Env) {
  await env.DB.prepare('DELETE FROM retailer_offer_cache WHERE expires_at<=?')
    .bind(Date.now())
    .run();
  for (const provider of ['amazon', 'bestbuy'] as const) {
    if (retailerReadiness(env, provider))
      await env.DB.prepare('DELETE FROM retailer_offer_cache WHERE provider_id=?')
        .bind(provider)
        .run();
  }
}

// Called by Cron even when monitoring is paused: retention cleanup must continue.
export async function collectRetailerOffers(env: Env, request: typeof fetch = fetch) {
  await purgeRetailerOffers(env);
  const settings = await getSettings(env.DB);
  if (env.APP_MODE !== 'production' || !settings.monitoringEnabled)
    return { checked: 0, offers: 0 };
  const owner = crypto.randomUUID();
  if (!(await lock(env.DB, 'retailer-offers', owner, 120000))) return { checked: 0, offers: 0 };
  let checked = 0,
    count = 0;
  try {
    // At most one request per retailer per run, up to 10 products per request.
    for (const provider of ['amazon', 'bestbuy'] as const) {
      if (retailerReadiness(env, provider)) continue;
      const target = await env.DB.prepare(
        `SELECT t.* FROM retailer_targets t
        JOIN data_providers p ON p.id=t.provider_id JOIN categories c ON c.id=t.category_id
        WHERE t.provider_id=? AND t.enabled=1 AND p.enabled=1 AND c.enabled=1
        AND p.paused_until<=? AND t.next_check_at<=? ORDER BY t.next_check_at,t.rowid LIMIT 1`,
      )
        .bind(provider, Date.now(), Date.now())
        .first<TargetRow>();
      if (!target) continue;
      checked++;
      try {
        const input: OfferTarget = {
          provider,
          mode: target.mode,
          query: target.query,
          category: target.category_id,
          autoPublish: !!target.auto_publish,
        };
        const offers = await (
          provider === 'amazon' ? new AmazonOffers(env, request) : new BestBuyOffers(env, request)
        ).collect(input);
        const previous = (
          await env.DB.prepare('SELECT * FROM retailer_offer_cache WHERE target_id=?')
            .bind(target.id)
            .all<CachedOffer>()
        ).results;
        const approved = new Map(
          previous.map((row) => [
            row.id,
            { value: row.approved, identity: (JSON.parse(row.payload) as RetailerOffer).identity },
          ]),
        );
        await env.DB.batch([
          // Replace the display cache, including removing unavailable or MAP-restricted products.
          env.DB.prepare('DELETE FROM retailer_offer_cache WHERE target_id=?').bind(target.id),
          ...offers.map((offer) =>
            env.DB.prepare(
              `INSERT INTO retailer_offer_cache
            (id,target_id,provider_id,payload,approved,fetched_at,expires_at) VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,payload=excluded.payload,
            approved=excluded.approved,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`,
            ).bind(
              offer.id,
              target.id,
              provider,
              JSON.stringify(offer),
              approved.get(offer.id)?.identity === offer.identity
                ? approved.get(offer.id)!.value
                : target.auto_publish,
              offer.checkedAt,
              offer.expiresAt,
            ),
          ),
          env.DB.prepare(
            'UPDATE retailer_targets SET last_checked_at=?,next_check_at=?,failures=0,last_error=NULL WHERE id=?',
          ).bind(Date.now(), Date.now() + settings.monitoringMinutes * 60000, target.id),
          env.DB.prepare('UPDATE data_providers SET paused_until=? WHERE id=?').bind(
            Date.now() + 2000,
            provider,
          ),
        ]);
        count += offers.length;
      } catch (error) {
        const failure = error instanceof ProviderError ? error : new ProviderError('invalid');
        const pause =
          Date.now() +
          Math.max(
            failure.retryAfter,
            Math.min(86400000, 60000 * 2 ** Math.min(target.failures, 10)),
          );
        await env.DB.batch([
          env.DB.prepare(
            'UPDATE retailer_targets SET failures=failures+1,last_error=?,next_check_at=? WHERE id=?',
          ).bind(failure.message, pause, target.id),
          env.DB.prepare(
            'UPDATE data_providers SET paused_until=?,enabled=CASE WHEN ? THEN 0 ELSE enabled END WHERE id=?',
          ).bind(pause, +(failure.code === 'auth'), provider),
          // Fail closed on invalid content/auth, including stale cached links after bad responses.
          ...(failure.code === 'auth' || failure.code === 'invalid'
            ? [
                env.DB.prepare('DELETE FROM retailer_offer_cache WHERE provider_id=?').bind(
                  provider,
                ),
              ]
            : []),
        ]);
        await logError(env.DB, `retailer:${provider}`, failure.message);
      }
    }
    return { checked, offers: count };
  } finally {
    await unlock(env.DB, 'retailer-offers', owner);
  }
}

export async function publicRetailerOffers(env: Env): Promise<RetailerOffer[]> {
  if (env.APP_MODE !== 'production') return [];
  const rows = await env.DB.prepare(
    `SELECT o.* FROM retailer_offer_cache o
    JOIN retailer_targets t ON t.id=o.target_id JOIN data_providers p ON p.id=o.provider_id
    JOIN categories c ON c.id=t.category_id WHERE o.approved=1 AND o.expires_at>?
    AND t.enabled=1 AND p.enabled=1 AND c.enabled=1 ORDER BY o.fetched_at DESC LIMIT 100`,
  )
    .bind(Date.now())
    .all<CachedOffer>();
  return rows.results.flatMap((row) => {
    if (retailerReadiness(env, row.provider_id)) return [];
    try {
      const offer = JSON.parse(row.payload) as RetailerOffer;
      // Revalidate after credential/tag/host changes; never send old partner links.
      validateOfferLink(offer, env);
      if (offer.provider === 'bestbuy' && offer.affiliate && !env.BESTBUY_IMPACT_PARTNER_ID)
        return [];
      return [offer];
    } catch {
      return [];
    }
  });
}
