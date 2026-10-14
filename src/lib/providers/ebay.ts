import type { Listing, Env } from '../types';
import { ebayToken } from './ebay-auth';
import { ProviderError, type ProductProvider } from './interface';
import { safeExternalUrl } from '../affiliate/links';
export class EbayProvider implements ProductProvider {
  id = 'ebay';
  minIntervalMs = 2000;
  constructor(
    private env: Env,
    private request: typeof fetch = fetch,
  ) {}
  async refresh(listing: Listing): Promise<Listing> {
    const token = await ebayToken(this.env, this.request);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    };
    if (this.env.EBAY_CAMPAIGN_ID)
      headers['X-EBAY-C-ENDUSERCTX'] =
        `affiliateCampaignId=${encodeURIComponent(this.env.EBAY_CAMPAIGN_ID)}`;
    const response = await this.request(
      `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(listing.externalId)}`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (response.status === 429)
      throw new ProviderError(
        'rate-limit',
        Math.max(60000, Number(response.headers.get('retry-after') ?? 60) * 1000),
      );
    if (response.status === 401 || response.status === 403) throw new ProviderError('auth');
    if (response.status === 404) return { ...listing, available: false, checkedAt: Date.now() };
    if (!response.ok) throw new ProviderError('temporary');
    const data: any = await response.json();
    // A fixed listing is monitored; title/model/variant/condition changes require a new identity and human review.
    const condition =
      data.conditionId === '1000' ? 'new' : data.conditionId === '3000' ? 'used' : 'refurbished';
    if (
      data.itemId !== listing.externalId ||
      data.title !== listing.name ||
      condition !== listing.condition ||
      data.price?.currency !== 'USD'
    )
      throw new ProviderError('invalid');
    const price = Math.round(Number(data.price.value) * 100),
      shipping =
        data.shippingOptions?.[0]?.shippingCost?.currency === 'USD'
          ? Math.round(Number(data.shippingOptions[0].shippingCost.value) * 100)
          : null;
    if (
      !Number.isSafeInteger(price) ||
      price <= 0 ||
      (shipping !== null && (!Number.isSafeInteger(shipping) || shipping < 0))
    )
      throw new ProviderError('invalid');
    const available =
      data.estimatedAvailabilities?.some(
        (a: any) => a.estimatedAvailabilityStatus === 'IN_STOCK',
      ) ?? false;
    return {
      ...listing,
      price,
      shipping,
      available,
      checkedAt: Date.now(),
      originalUrl: safeExternalUrl(data.itemWebUrl, ['www.ebay.com', 'ebay.com']),
      affiliateUrl: data.itemAffiliateWebUrl
        ? safeExternalUrl(data.itemAffiliateWebUrl, ['www.ebay.com', 'ebay.com', 'rover.ebay.com'])
        : null,
    };
  }
}
