import type { Listing, Observation, DealView, Env } from '../types';
import { getSettings } from '../config';
export const dealSelect = `SELECT d.*,p.name,p.brand,p.model,p.variant,p.category_id,p.specs,c.name category_name,r.name retailer,l.retailer_id,l.condition,l.currency,l.price_cents,l.shipping_cents,l.checked_at,l.available,l.demo,l.original_url,l.affiliate_url,l.image_url,l.image_permitted,l.identity_key,(SELECT MIN(po.price_cents+po.shipping_cents) FROM price_observations po WHERE po.listing_id=l.id AND po.identity_key=l.identity_key AND po.currency=l.currency AND po.shipping_cents IS NOT NULL AND po.observed_at<=l.checked_at) observed_low_cents FROM deals d JOIN product_listings l ON l.id=d.listing_id JOIN products p ON p.id=l.product_id JOIN categories c ON c.id=p.category_id JOIN retailers r ON r.id=l.retailer_id`;
export async function publicDeals(
  env: Env,
  options: {
    query?: string;
    category?: string;
    sort?: string;
    limit?: number;
    offset?: number;
    maxPrice?: number;
  } = {},
) {
  const settings = await getSettings(env.DB);
  const where = [
    "d.status='active'",
    'l.available=1',
    'c.enabled=1',
    'l.demo=?',
    'l.checked_at>=?',
    'd.current_cents=l.price_cents+COALESCE(l.shipping_cents,0)',
  ];
  const values: (string | number)[] = [
    env.APP_MODE === 'demo' ? 1 : 0,
    Date.now() - settings.freshnessMinutes * 60000,
  ];
  if (options.query) {
    where.push('(p.name LIKE ? OR p.brand LIKE ?)');
    values.push(`%${options.query.slice(0, 100)}%`, `%${options.query.slice(0, 100)}%`);
  }
  if (options.category) {
    where.push('c.id=?');
    values.push(options.category);
  }
  if (options.maxPrice) {
    where.push('d.current_cents<=?');
    values.push(options.maxPrice);
  }
  const order =
    options.sort === 'discount'
      ? 'd.discount DESC'
      : options.sort === 'recent'
        ? 'd.detected_at DESC'
        : options.sort === 'price'
          ? 'd.current_cents ASC'
          : 'd.featured DESC,d.score DESC';
  const result = await env.DB.prepare(
    `${dealSelect} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
  )
    .bind(...values, options.limit ?? 24, options.offset ?? 0)
    .all<DealView>();
  return result.results;
}
export async function observations(db: D1Database, id: string): Promise<Observation[]> {
  const r = await db
    .prepare(
      'SELECT * FROM price_observations WHERE listing_id=? ORDER BY observed_at DESC LIMIT 1500',
    )
    .bind(id)
    .all<any>();
  return r.results.map((o) => ({
    listingId: o.listing_id,
    price: o.price_cents,
    shipping: o.shipping_cents,
    currency: o.currency,
    at: o.observed_at,
    identityKey: o.identity_key,
    source: o.source,
  }));
}
export async function getListing(db: D1Database, id: string): Promise<Listing | null> {
  const r = await db
    .prepare(
      'SELECT l.*,p.name,p.brand,p.model,p.variant,p.category_id,p.specs FROM product_listings l JOIN products p ON p.id=l.product_id WHERE l.id=?',
    )
    .bind(id)
    .first<any>();
  return r ? fromRow(r) : null;
}
export function fromRow(r: any): Listing {
  return {
    id: r.id,
    productId: r.product_id,
    externalId: r.external_id,
    provider: r.provider_id,
    retailer: r.retailer_id,
    name: r.name,
    brand: r.brand,
    model: r.model,
    variant: r.variant,
    category: r.category_id,
    condition: r.condition,
    currency: r.currency,
    price: r.price_cents,
    shipping: r.shipping_cents,
    originalUrl: r.original_url,
    affiliateUrl: r.affiliate_url,
    imageUrl: r.image_url,
    imagePermitted: !!r.image_permitted,
    available: !!r.available,
    demo: !!r.demo,
    checkedAt: r.checked_at,
    identityKey: r.identity_key,
    sellerConfidence: r.seller_confidence,
    specs: JSON.parse(r.specs ?? '{}'),
  };
}
export async function audit(db: D1Database, actor: string, action: string, target = '') {
  await db
    .prepare('INSERT INTO administrator_audit_events VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), actor, action, target, Date.now())
    .run();
}
export async function logError(db: D1Database, scope: string, message: string) {
  await db
    .prepare('INSERT INTO error_logs VALUES (?,?,?,?)')
    .bind(crypto.randomUUID(), scope, message.slice(0, 300), Date.now())
    .run();
}
export async function lock(db: D1Database, key: string, owner: string, ttl = 120000) {
  const r = await db
    .prepare(
      'INSERT INTO distributed_locks VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE distributed_locks.expires_at<? RETURNING owner',
    )
    .bind(key, owner, Date.now() + ttl, Date.now())
    .first<{ owner: string }>();
  return r?.owner === owner;
}
export async function unlock(db: D1Database, key: string, owner: string) {
  await db.prepare('DELETE FROM distributed_locks WHERE key=? AND owner=?').bind(key, owner).run();
}
