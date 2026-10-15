import type { Env } from '../types';
import { ProviderError } from './interface';
import { safeExternalUrl } from '../affiliate/links';
import {
  cents,
  itemIds,
  retailerJson,
  retailerReadiness,
  targetSchema,
  validateOfferLink,
  type OfferTarget,
  type RetailerOffer,
} from './retailer-offers';

export class BestBuyOffers {
  constructor(
    private env: Env,
    private request: typeof fetch = fetch,
  ) {}
  async collect(input: OfferTarget): Promise<RetailerOffer[]> {
    if (retailerReadiness(this.env, 'bestbuy')) throw new ProviderError('auth');
    const target = targetSchema.parse(input);
    if (target.provider !== 'bestbuy') throw new ProviderError('invalid');
    const filter =
      target.mode === 'search'
        ? target.query
            .trim()
            .split(/\s+/)
            .map((word) => `search=${encodeURIComponent(word)}`)
            .join('&')
        : `sku in(${itemIds(target.query).join(',')})`;
    const url = new URL(`https://api.bestbuy.com/v1/products(${filter})`);
    url.searchParams.set('apiKey', this.env.BESTBUY_API_KEY!);
    url.searchParams.set('format', 'json');
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('page', '1');
    url.searchParams.set(
      'show',
      'sku,name,modelNumber,condition,active,onlineAvailability,salePrice,shippingCost,url,affiliateUrl',
    );
    if (this.env.BESTBUY_IMPACT_PARTNER_ID)
      url.searchParams.set('IPID', this.env.BESTBUY_IMPACT_PARTNER_ID);
    const result = await retailerJson(this.request, url.href);
    if (!Array.isArray(result.products) || result.products.length > 10)
      throw new ProviderError('invalid');
    const offers: RetailerOffer[] = [];
    for (const product of result.products) {
      const sku = String(product.sku ?? '');
      if (
        !/^[1-9]\d{0,9}$/.test(sku) ||
        (target.mode === 'items' && !itemIds(target.query).includes(sku))
      )
        throw new ProviderError('invalid');
      if (
        product.active !== true ||
        product.onlineAvailability !== true ||
        product.condition?.toLowerCase() !== 'new'
      )
        continue;
      const price = cents(product.salePrice);
      if (!price || typeof product.name !== 'string' || !product.name || product.name.length > 500)
        continue;
      let original: URL;
      try {
        original = new URL(safeExternalUrl(product.url, ['www.bestbuy.com', 'bestbuy.com']));
      } catch {
        throw new ProviderError('invalid');
      }
      if (original.searchParams.get('skuId') !== sku && !original.pathname.endsWith(`/${sku}.p`))
        throw new ProviderError('invalid');
      const checkedAt = Date.now();
      const affiliate = !!(
        this.env.BESTBUY_IMPACT_PARTNER_ID &&
        this.env.BESTBUY_AFFILIATE_HOSTS &&
        product.affiliateUrl
      );
      const offer: RetailerOffer = {
        id: `bestbuy-${sku}`,
        externalId: sku,
        provider: 'bestbuy',
        name: product.name,
        category: target.category,
        price,
        shipping: cents(product.shippingCost),
        url: affiliate ? product.affiliateUrl : original.href,
        affiliate,
        affiliateAccount: affiliate ? this.env.BESTBUY_IMPACT_PARTNER_ID : undefined,
        seller: 'Best Buy',
        identity: `${sku}|${product.modelNumber ?? ''}|new|USD`,
        checkedAt,
        expiresAt: checkedAt + 3600000,
      };
      try {
        offer.url = validateOfferLink(offer, this.env);
      } catch {
        throw new ProviderError('invalid');
      }
      offers.push(offer);
    }
    if (new Set(offers.map((o) => o.id)).size !== offers.length) throw new ProviderError('invalid');
    return offers;
  }
}
