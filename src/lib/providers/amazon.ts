import type { Env } from '../types';
import { ProviderError } from './interface';
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

const resources = [
  'itemInfo.title',
  'offersV2.listings.price',
  'offersV2.listings.availability',
  'offersV2.listings.condition',
  'offersV2.listings.dealDetails',
  'offersV2.listings.merchantInfo',
  'offersV2.listings.isBuyBoxWinner',
  'offersV2.listings.type',
];
const normalized = (value: unknown) =>
  String(value ?? '')
    .replace(/_/g, '')
    .toUpperCase();

// One client per run; a reused client reuses its token. Secrets are never persisted to D1.
export class AmazonOffers {
  private token?: { value: string; expires: number };
  constructor(
    private env: Env,
    private request: typeof fetch = fetch,
  ) {}
  private async accessToken() {
    if (this.token && this.token.expires > Date.now() + 60000) return this.token.value;
    const result = await retailerJson(this.request, 'https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.env.AMAZON_CREATORS_CLIENT_ID,
        client_secret: this.env.AMAZON_CREATORS_CLIENT_SECRET,
        scope: 'creatorsapi::default',
      }),
    });
    if (
      typeof result.access_token !== 'string' ||
      !result.access_token ||
      typeof result.expires_in !== 'number' ||
      result.expires_in <= 60
    )
      throw new ProviderError('auth');
    this.token = {
      value: result.access_token,
      expires: Date.now() + Math.min(3600, result.expires_in) * 1000,
    };
    return this.token.value;
  }
  async collect(input: OfferTarget): Promise<RetailerOffer[]> {
    if (retailerReadiness(this.env, 'amazon')) throw new ProviderError('auth');
    const target = targetSchema.parse(input);
    if (target.provider !== 'amazon') throw new ProviderError('invalid');
    const result = await retailerJson(
      this.request,
      `https://creatorsapi.amazon/catalog/v1/${target.mode === 'search' ? 'searchItems' : 'getItems'}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await this.accessToken()}`,
          'x-marketplace': 'www.amazon.com',
        },
        body: JSON.stringify({
          marketplace: 'www.amazon.com',
          partnerTag: this.env.AMAZON_PARTNER_TAG,
          condition: 'New',
          resources,
          ...(target.mode === 'search'
            ? { keywords: target.query, searchIndex: 'Electronics', itemCount: 10, itemPage: 1 }
            : { itemIds: itemIds(target.query), itemIdType: 'ASIN' }),
        }),
      },
    );
    if (result.errors?.length && !result.searchResult && !result.itemsResult && !result.itemResults)
      throw new ProviderError('invalid');
    const items =
      target.mode === 'search'
        ? result.searchResult?.items
        : (result.itemsResult ?? result.itemResults)?.items;
    if (!Array.isArray(items) || items.length > 10) throw new ProviderError('invalid');
    const offers: RetailerOffer[] = [];
    for (const item of items) {
      const asin = item.asin;
      if (
        typeof asin !== 'string' ||
        !/^[A-Z0-9]{10}$/.test(asin) ||
        (target.mode === 'items' && !itemIds(target.query).includes(asin))
      )
        throw new ProviderError('invalid');
      const listings = item.offersV2?.listings;
      if (!Array.isArray(listings)) continue;
      // Suppress restricted, unknown-stock, subscription, and member-only offers.
      const listing = listings.find((l: any) => l.isBuyBoxWinner === true);
      if (
        !listing ||
        listing.violatesMAP !== false ||
        normalized(listing.condition?.value) !== 'NEW' ||
        !['INSTOCK', 'INSTOCKSCARCE'].includes(normalized(listing.availability?.type)) ||
        normalized(listing.type) === 'SUBSCRIBEANDSAVE' ||
        (listing.dealDetails?.accessType && normalized(listing.dealDetails.accessType) !== 'ALL') ||
        (listing.dealDetails?.startTime &&
          Date.parse(listing.dealDetails.startTime) > Date.now()) ||
        (listing.dealDetails?.endTime && Date.parse(listing.dealDetails.endTime) <= Date.now())
      )
        continue;
      const price = cents(listing.price?.money?.amount);
      const name = item.itemInfo?.title?.displayValue;
      if (
        !price ||
        listing.price?.money?.currency !== 'USD' ||
        typeof name !== 'string' ||
        !name ||
        name.length > 500
      )
        continue;
      const checkedAt = Date.now();
      const expiresAt = Math.min(
        checkedAt + 3600000,
        listing.dealDetails?.endTime ? Date.parse(listing.dealDetails.endTime) : Infinity,
      );
      if (!Number.isFinite(expiresAt) || expiresAt <= checkedAt) continue;
      const offer: RetailerOffer = {
        id: `amazon-${asin}`,
        externalId: asin,
        provider: 'amazon',
        name,
        category: target.category,
        price,
        shipping: null,
        url: item.detailPageURL,
        affiliate: true,
        seller:
          typeof listing.merchantInfo?.name === 'string' ? listing.merchantInfo.name : 'See Amazon',
        identity: `${asin}|${listing.merchantInfo?.id ?? listing.merchantInfo?.name ?? ''}|new|USD`,
        checkedAt,
        expiresAt,
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
