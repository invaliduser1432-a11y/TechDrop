export interface Env {
  DB: D1Database;
  APP_MODE: 'demo' | 'production';
  SITE_URL: string;
  ALLOW_LOCAL_ADMIN?: string;
  LOCAL_ADMIN_TOKEN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_EMAILS?: string;
  BUFFER_TOKEN?: string;
  LIVE_PUBLISHING_ALLOWED?: string;
  EBAY_ACCESS_TOKEN?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_CAMPAIGN_ID?: string;
  FEED_HOSTS?: string;
}
export interface Listing {
  id: string;
  productId: string;
  externalId: string;
  provider: string;
  retailer: string;
  name: string;
  brand: string;
  model: string;
  variant: string;
  category: string;
  condition: 'new' | 'used' | 'refurbished';
  currency: 'USD';
  price: number;
  shipping: number | null;
  originalUrl: string;
  affiliateUrl?: string | null;
  imageUrl?: string | null;
  imagePermitted: boolean;
  available: boolean;
  demo: boolean;
  checkedAt: number;
  identityKey: string;
  sellerConfidence?: number | null;
  specs?: Record<string, string>;
}
export interface Observation {
  listingId: string;
  price: number;
  shipping: number | null;
  currency: string;
  at: number;
  identityKey: string;
  source: string;
}
export interface DealView {
  id: string;
  listing_id: string;
  slug: string;
  name: string;
  brand: string;
  model: string;
  variant: string;
  category_id: string;
  category_name: string;
  retailer: string;
  retailer_id: string;
  condition: string;
  currency: string;
  price_cents: number;
  shipping_cents: number | null;
  baseline_cents: number;
  current_cents: number;
  savings_cents: number;
  discount: number;
  score: number;
  observed_low_cents: number | null;
  status: string;
  featured: number;
  detected_at: number;
  checked_at: number;
  available: number;
  demo: number;
  original_url: string;
  affiliate_url: string | null;
  image_url: string | null;
  image_permitted: number;
  specs: string;
  identity_key: string;
}
export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const timeAgo = (at: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return minutes < 1
    ? 'just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
};
