import type { Listing, Env } from '../types';
import { getListing } from '../db/repository';
export async function importListings(env: Env, listings: Listing[]) {
  for (const l of listings) {
    if (env.APP_MODE === 'production' && (l.demo || l.provider === 'mock'))
      throw new Error('Production refuses demonstration data');
    const existing = await getListing(env.DB, l.id);
    if (existing && existing.identityKey !== l.identityKey)
      throw new Error('Listing identity changed; import a new listing ID');
    const category = await env.DB.prepare('SELECT id FROM categories WHERE id=?')
      .bind(l.category)
      .first();
    if (!category) throw new Error(`Create category ${l.category} first`);
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO products(id,name,brand,model,variant,category_id,specs) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category_id=excluded.category_id,specs=excluded.specs',
      ).bind(
        l.productId,
        l.name,
        l.brand,
        l.model,
        l.variant,
        l.category,
        JSON.stringify(l.specs ?? {}),
      ),
      env.DB.prepare(
        `INSERT INTO product_listings(id,product_id,external_id,provider_id,retailer_id,condition,currency,price_cents,shipping_cents,original_url,affiliate_url,image_url,image_permitted,available,demo,checked_at,next_check_at,seller_confidence,identity_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET price_cents=excluded.price_cents,shipping_cents=excluded.shipping_cents,available=excluded.available,checked_at=excluded.checked_at,next_check_at=excluded.next_check_at,original_url=excluded.original_url,affiliate_url=excluded.affiliate_url,image_url=excluded.image_url,image_permitted=excluded.image_permitted`,
      ).bind(
        l.id,
        l.productId,
        l.externalId,
        l.provider,
        l.retailer,
        l.condition,
        l.currency,
        l.price,
        l.shipping,
        l.originalUrl,
        l.affiliateUrl ?? null,
        l.imageUrl ?? null,
        +l.imagePermitted,
        +l.available,
        +l.demo,
        l.checkedAt,
        l.checkedAt + 1800000,
        l.sellerConfidence ?? null,
        l.identityKey,
      ),
      env.DB.prepare(
        'INSERT OR IGNORE INTO price_observations(listing_id,price_cents,shipping_cents,currency,observed_at,source,identity_key) VALUES (?,?,?,?,?,?,?)',
      ).bind(l.id, l.price, l.shipping, l.currency, l.checkedAt, l.provider, l.identityKey),
    ]);
  }
}
