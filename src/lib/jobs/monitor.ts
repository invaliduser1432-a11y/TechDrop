import type { Env, Listing } from '../types';
import { getSettings } from '../config';
import { getListing, observations, logError, lock, unlock } from '../db/repository';
import { scoreDeal } from '../price/scoring';
import { MockProvider } from '../providers/mock';
import { EbayProvider } from '../providers/ebay';
import { ProviderError, type ProductProvider } from '../providers/interface';
export async function evaluate(env: Env, l: Listing) {
  const settings = await getSettings(env.DB),
    history = await observations(env.DB, l.id);
  const prior = await env.DB.prepare('SELECT MAX(published_at) last FROM deals WHERE listing_id=?')
    .bind(l.id)
    .first<{ last: number | null }>();
  const result = scoreDeal(l, history, settings, prior?.last ?? null);
  // Any price change invalidates the published snapshot, even if the new price is lower.
  await env.DB.prepare(
    "UPDATE deals SET status='expired' WHERE listing_id=? AND status IN ('active','review') AND (current_cents<>? OR ?=0)",
  )
    .bind(l.id, result.current, +l.available)
    .run();
  if (!result.qualified) return result;
  const bucket = Math.floor(Date.now() / (settings.duplicateHours * 3600000)),
    fingerprint = `${l.id}:${l.identityKey}:${bucket}`;
  const id = crypto.randomUUID(),
    slug = `${l.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 75)}-${id.slice(0, 8)}`;
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO deals(id,listing_id,slug,baseline_cents,current_cents,savings_cents,discount,score,status,detected_at,published_at,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
  )
    .bind(
      id,
      l.id,
      slug,
      result.baseline,
      result.current,
      result.savings,
      result.discount,
      result.score,
      settings.autoApproveDeals ? 'active' : 'review',
      Date.now(),
      settings.autoApproveDeals ? Date.now() : null,
      fingerprint,
    )
    .first<{ id: string }>();
  if (inserted)
    await env.DB.prepare('INSERT INTO deal_scores VALUES (?,?,?,?)')
      .bind(id, JSON.stringify(result.components), JSON.stringify(result.reasons), Date.now())
      .run();
  return result;
}
export async function monitor(env: Env, recheckId?: string, runKey?: string) {
  const settings = await getSettings(env.DB);
  if (!settings.monitoringEnabled && !recheckId) return { checked: 0, paused: true };
  const owner = crypto.randomUUID();
  if (!(await lock(env.DB, 'monitor', owner, 300000))) return { checked: 0, busy: true };
  const id = runKey ?? `monitor:${Math.floor(Date.now() / 1800000)}`;
  let checked = 0;
  try {
    const done = await env.DB.prepare('SELECT status FROM scheduled_job_runs WHERE id=?')
      .bind(id)
      .first<{ status: string }>();
    if (done?.status === 'success' && !recheckId) return { checked: 0, duplicate: true };
    await env.DB.prepare(
      "INSERT INTO scheduled_job_runs(id,kind,started_at) VALUES (?,'monitor',?) ON CONFLICT(id) DO UPDATE SET status='running',started_at=excluded.started_at",
    )
      .bind(id, Date.now())
      .run();
    const rows = await env.DB.prepare(
      `SELECT l.id FROM product_listings l JOIN data_providers p ON p.id=l.provider_id JOIN products pr ON pr.id=l.product_id JOIN categories c ON c.id=pr.category_id WHERE p.enabled=1 AND c.enabled=1 AND p.paused_until<=? AND l.demo=? AND ${recheckId ? 'l.id=?' : 'l.next_check_at<=?'} ORDER BY l.next_check_at LIMIT ?`,
    )
      .bind(
        Date.now(),
        env.APP_MODE === 'demo' ? 1 : 0,
        recheckId ?? Date.now(),
        settings.batchSize,
      )
      .all<{ id: string }>();
    const providers: Record<string, ProductProvider> = {
      mock: new MockProvider(),
      ebay: new EbayProvider(env),
    };
    const lastRequest: Record<string, number> = {};
    for (const row of rows.results) {
      const listing = await getListing(env.DB, row.id);
      if (!listing) continue;
      const provider = providers[listing.provider];
      // Uploaded feeds have no authorized automatic endpoint; await the next import.
      if (!provider) {
        await env.DB.prepare('UPDATE product_listings SET next_check_at=? WHERE id=?')
          .bind(Date.now() + 86400000, row.id)
          .run();
        continue;
      }
      try {
        const cooldown = Math.max(
          0,
          (lastRequest[provider.id] ?? 0) + provider.minIntervalMs - Date.now(),
        );
        if (cooldown) await new Promise((r) => setTimeout(r, cooldown));
        lastRequest[provider.id] = Date.now();
        const updated = await provider.refresh(listing);
        if (updated.identityKey !== listing.identityKey || updated.id !== listing.id)
          throw new ProviderError('invalid');
        await env.DB.batch([
          env.DB.prepare(
            'UPDATE product_listings SET price_cents=?,shipping_cents=?,available=?,checked_at=?,next_check_at=?,failures=0,affiliate_url=? WHERE id=?',
          ).bind(
            updated.price,
            updated.shipping,
            +updated.available,
            updated.checkedAt,
            updated.checkedAt + settings.monitoringMinutes * 60000,
            updated.affiliateUrl ?? null,
            updated.id,
          ),
          env.DB.prepare(
            'INSERT OR IGNORE INTO price_observations(listing_id,price_cents,shipping_cents,currency,observed_at,source,identity_key) VALUES (?,?,?,?,?,?,?)',
          ).bind(
            updated.id,
            updated.price,
            updated.shipping,
            updated.currency,
            updated.checkedAt,
            updated.provider,
            updated.identityKey,
          ),
        ]);
        await evaluate(env, updated);
        checked++;
      } catch (error) {
        const safe = error instanceof ProviderError ? error : new ProviderError('temporary');
        await logError(env.DB, listing.provider, safe.message);
        await env.DB.prepare(
          'UPDATE product_listings SET failures=failures+1,next_check_at=? WHERE id=?',
        )
          .bind(Date.now() + safe.retryAfter, row.id)
          .run();
        const f = await env.DB.prepare('SELECT failures FROM product_listings WHERE id=?')
          .bind(row.id)
          .first<{ failures: number }>();
        await env.DB.prepare('UPDATE product_listings SET next_check_at=? WHERE id=?')
          .bind(
            Date.now() + Math.min(86400000, safe.retryAfter * 2 ** Math.min(f?.failures ?? 1, 8)),
            row.id,
          )
          .run();
        if (safe.code === 'rate-limit' || safe.code === 'auth') {
          await env.DB.prepare(
            'UPDATE data_providers SET paused_until=?,enabled=CASE WHEN ?=1 THEN 0 ELSE enabled END WHERE id=?',
          )
            .bind(Date.now() + safe.retryAfter, safe.code === 'auth' ? 1 : 0, provider.id)
            .run();
          break;
        }
      }
    }
    await env.DB.prepare(
      "UPDATE scheduled_job_runs SET status='success',checked=?,finished_at=? WHERE id=?",
    )
      .bind(checked, Date.now(), id)
      .run();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE deals SET status='expired' WHERE status='active' AND listing_id IN (SELECT id FROM product_listings WHERE checked_at<? OR available=0)",
      ).bind(Date.now() - 120 * 60000),
      env.DB.prepare('DELETE FROM error_logs WHERE created_at<?').bind(Date.now() - 30 * 86400000),
      env.DB.prepare('DELETE FROM affiliate_click_events WHERE created_at<?').bind(
        Date.now() - 90 * 86400000,
      ),
      env.DB.prepare('DELETE FROM scheduled_job_runs WHERE started_at<?').bind(
        Date.now() - 30 * 86400000,
      ),
      env.DB.prepare('DELETE FROM administrator_audit_events WHERE created_at<?').bind(
        Date.now() - 180 * 86400000,
      ),
      env.DB.prepare('DELETE FROM rate_limit_buckets WHERE window<?').bind(
        Math.floor(Date.now() / 60000) - 10,
      ),
    ]);
    return { checked };
  } catch {
    await logError(
      env.DB,
      'monitor',
      'Monitoring run failed; check database and provider configuration',
    );
    await env.DB.prepare("UPDATE scheduled_job_runs SET status='failed',finished_at=? WHERE id=?")
      .bind(Date.now(), id)
      .run();
    throw new Error('Monitoring run failed');
  } finally {
    await unlock(env.DB, 'monitor', owner);
  }
}
