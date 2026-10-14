import Papa from 'papaparse';
import { z } from 'zod';
import type { Listing } from '../types';
import { safeExternalUrl } from '../affiliate/links';
import { identity } from './interface';
const bool = z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean());
export const listingSchema = z.object({
  externalId: z.string().min(1).max(200),
  name: z.string().min(2).max(200),
  brand: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  variant: z.string().min(1).max(200),
  category: z.string().regex(/^[a-z0-9-]+$/),
  condition: z.enum(['new', 'used', 'refurbished']),
  currency: z.literal('USD'),
  price: z.coerce.number().int().positive().max(100000000),
  shipping: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.coerce.number().int().min(0).nullable(),
  ),
  originalUrl: z.url(),
  affiliateUrl: z.url().optional(),
  imageUrl: z.url().optional(),
  imagePermitted: bool.default(false),
  available: bool.default(true),
});
export function parseFeed(
  text: string,
  format: 'csv' | 'json',
  retailer: string,
  hosts: string[],
  affiliateHosts: string[],
  now = Date.now(),
): Listing[] {
  if (text.length > 1000000) throw new Error('Feed exceeds 1 MB');
  const raw =
    format === 'json' ? JSON.parse(text) : Papa.parse(text, { header: true, skipEmptyLines: true });
  if (format === 'csv' && raw.errors.length)
    throw new Error('Invalid CSV: check headers and quoting');
  const rows = z
    .array(listingSchema)
    .max(100)
    .parse(format === 'json' ? raw : raw.data);
  const seen = new Set<string>();
  return rows.map((row) => {
    if (seen.has(row.externalId)) throw new Error('Duplicate listing in feed');
    seen.add(row.externalId);
    const id = `feed-${retailer}-${row.externalId}`;
    const listing: Listing = {
      ...row,
      id,
      productId: `product-${encodeURIComponent([row.brand, row.model, row.variant].join('|'))}`,
      provider: 'feed',
      retailer,
      demo: false,
      checkedAt: now,
      originalUrl: safeExternalUrl(row.originalUrl, hosts),
      affiliateUrl: row.affiliateUrl ? safeExternalUrl(row.affiliateUrl, affiliateHosts) : null,
      imageUrl: row.imagePermitted && row.imageUrl ? safeExternalUrl(row.imageUrl, hosts) : null,
      identityKey: '',
    };
    listing.identityKey = identity(listing);
    return listing;
  });
}
