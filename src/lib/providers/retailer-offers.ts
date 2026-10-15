import { z } from 'zod';
import type { Env } from '../types';
import { safeExternalUrl } from '../affiliate/links';
import { ProviderError } from './interface';

export const retailerProvider = z.enum(['amazon', 'bestbuy']);
export type RetailerProvider = z.infer<typeof retailerProvider>;
export const targetSchema = z
  .object({
    provider: retailerProvider,
    mode: z.enum(['search', 'items']),
    query: z.string().trim().min(1).max(160),
    category: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    autoPublish: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const valid =
      value.mode === 'search'
        ? /^[a-zA-Z0-9 -]{1,80}$/.test(value.query)
        : itemIds(value.query).length > 0 &&
          itemIds(value.query).length <= 10 &&
          itemIds(value.query).every((id) =>
            (value.provider === 'amazon' ? /^[A-Z0-9]{10}$/ : /^[1-9]\d{0,9}$/).test(id),
          );
    if (!valid)
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Use a plain search phrase or up to 10 valid ASINs / SKUs, separated by commas.',
      });
  });
export type OfferTarget = z.infer<typeof targetSchema>;
export const itemIds = (input: string) => [...new Set(input.split(/[\s,]+/).filter(Boolean))];
export interface RetailerOffer {
  id: string;
  externalId: string;
  provider: RetailerProvider;
  name: string;
  category: string;
  price: number;
  shipping: number | null;
  url: string;
  affiliate: boolean;
  affiliateAccount?: string;
  seller: string;
  identity: string;
  checkedAt: number;
  expiresAt: number;
}
export function retailerReadiness(env: Env, provider: RetailerProvider): string | null {
  if (env.APP_MODE !== 'production') return 'Real retailer APIs require production mode';
  if (provider === 'amazon') {
    if (!env.AMAZON_SITE_APPROVAL_REFERENCE?.trim())
      return 'Amazon agreement for use on this price-tracking site is required';
    if (
      !env.AMAZON_CREATORS_CLIENT_ID ||
      !env.AMAZON_CREATORS_CLIENT_SECRET ||
      !env.AMAZON_PARTNER_TAG
    )
      return 'Configure Creators API credentials and your approved Amazon partner tag';
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(env.AMAZON_PARTNER_TAG)) return 'Invalid Amazon partner tag';
  } else {
    if (env.BESTBUY_API_APPROVED !== 'true' || !env.BESTBUY_API_KEY)
      return 'Configure an approved Best Buy Products API key and confirm permitted site use';
    if (env.BESTBUY_IMPACT_PARTNER_ID && !/^\d{1,30}$/.test(env.BESTBUY_IMPACT_PARTNER_ID))
      return 'Invalid Best Buy Impact partner ID';
  }
  return null;
}
export function validateOfferLink(offer: RetailerOffer, env: Env) {
  if (offer.provider === 'amazon') {
    const url = new URL(safeExternalUrl(offer.url, ['www.amazon.com', 'amazon.com']));
    if (
      url.searchParams.getAll('tag').length !== 1 ||
      url.searchParams.get('tag') !== env.AMAZON_PARTNER_TAG ||
      url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/)?.[1] !== offer.externalId
    )
      throw new ProviderError('invalid');
    return url.href;
  }
  if (offer.affiliate && offer.affiliateAccount !== env.BESTBUY_IMPACT_PARTNER_ID)
    throw new ProviderError('invalid');
  return safeExternalUrl(
    offer.url,
    offer.affiliate
      ? (env.BESTBUY_AFFILIATE_HOSTS ?? '')
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean)
      : ['www.bestbuy.com', 'bestbuy.com'],
  );
}
export async function retailerJson(request: typeof fetch, url: string, init: RequestInit = {}) {
  try {
    const response = await request(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const seconds = Number(response.headers.get('retry-after'));
      const until = Date.parse(response.headers.get('retry-after') ?? '');
      const delay = seconds > 0 ? seconds * 1000 : until - Date.now();
      throw new ProviderError(
        response.status === 429
          ? 'rate-limit'
          : [401, 403].includes(response.status)
            ? 'auth'
            : response.status >= 500
              ? 'temporary'
              : 'invalid',
        Number.isFinite(delay) ? Math.min(86400000, Math.max(60000, delay)) : 60000,
      );
    }
    if (Number(response.headers.get('content-length') ?? 0) > 2000000)
      throw new ProviderError('invalid');
    const text = await response.text();
    if (text.length > 2000000) throw new ProviderError('invalid');
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('temporary'); // Never retain URLs, API keys, or remote error bodies.
  }
}
export function cents(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000
    ? Math.round(value * 100)
    : null;
}
