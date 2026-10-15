import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmazonOffers } from '../../src/lib/providers/amazon';
import { BestBuyOffers } from '../../src/lib/providers/bestbuy';
import {
  targetSchema,
  retailerReadiness,
  type OfferTarget,
} from '../../src/lib/providers/retailer-offers';
import {
  addRetailerTarget,
  collectRetailerOffers,
  publicRetailerOffers,
} from '../../src/lib/jobs/retailer-offers';
import { importListings } from '../../src/lib/providers/import';
import { getSettings, saveSettings } from '../../src/lib/config';
import { setup, fixture } from '../helpers/database';
import type { Env } from '../../src/lib/types';

const credentials = {
  APP_MODE: 'production',
  AMAZON_CREATORS_CLIENT_ID: 'test-client',
  AMAZON_CREATORS_CLIENT_SECRET: 'test-secret',
  AMAZON_PARTNER_TAG: 'test-20',
  AMAZON_SITE_APPROVAL_REFERENCE: 'test-written-site-agreement',
  BESTBUY_API_KEY: 'test-key',
  BESTBUY_API_APPROVED: 'true',
} as const;
const target = (provider: 'amazon' | 'bestbuy', autoPublish = false): OfferTarget => ({
  provider,
  mode: 'items',
  query: provider === 'amazon' ? 'B012345678' : '1234567',
  category: 'storage',
  autoPublish,
});
const listing = () => ({
  isBuyBoxWinner: true,
  violatesMAP: false,
  availability: { type: 'IN_STOCK' },
  condition: { value: 'New' },
  price: {
    money: { amount: 89.99, currency: 'USD' },
    savingBasis: { money: { amount: 299 } },
    savings: { percentage: 70 },
  },
  merchantInfo: { name: 'Amazon.com', id: 'seller-one' },
  type: 'NORMAL',
});
const amazonItem = (offer = listing()) => ({
  asin: 'B012345678',
  detailPageURL: 'https://www.amazon.com/dp/B012345678?tag=test-20',
  itemInfo: { title: { displayValue: 'Real SSD 2TB' } },
  offersV2: { listings: [offer] },
});
const bestbuyItem = () => ({
  sku: 1234567,
  name: 'Real SSD 2TB',
  modelNumber: 'N2',
  condition: 'New',
  active: true,
  onlineAvailability: true,
  salePrice: 89.99,
  shippingCost: 0,
  regularPrice: 299,
  url: 'https://www.bestbuy.com/site/drive/1234567.p?skuId=1234567',
  affiliateUrl: 'https://approved.example/c/123/offer',
});
function amazonFetch(item = amazonItem()) {
  return vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes('/auth/')
        ? Response.json({ access_token: 'test-token', expires_in: 3600 })
        : Response.json({ itemsResult: { items: [item] }, searchResult: { items: [item] } }),
    );
}
const bestbuyFetch = (item = bestbuyItem()) =>
  vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ products: [item] }));
const env = () => ({ ...credentials }) as Env;
afterEach(() => vi.useRealTimers());

describe('official retailer adapters', () => {
  it('requires production credentials and the actual Amazon site agreement', async () => {
    const request = amazonFetch();
    expect(retailerReadiness({ ...env(), AMAZON_SITE_APPROVAL_REFERENCE: '' }, 'amazon')).toContain(
      'agreement',
    );
    await expect(
      new AmazonOffers({ ...env(), AMAZON_SITE_APPROVAL_REFERENCE: '' }, request).collect(
        target('amazon'),
      ),
    ).rejects.toMatchObject({ code: 'auth' });
    await expect(
      new BestBuyOffers({ ...env(), BESTBUY_API_APPROVED: 'false' }, request).collect(
        target('bestbuy'),
      ),
    ).rejects.toMatchObject({ code: 'auth' });
    await expect(
      new AmazonOffers({ ...env(), APP_MODE: 'demo' }, request).collect(target('amazon')),
    ).rejects.toMatchObject({ code: 'auth' });
    expect(request).not.toHaveBeenCalled();
  });
  it('uses Creators OAuth JSON, documented headers and OffersV2 resources; reuses a token', async () => {
    const request = amazonFetch(),
      client = new AmazonOffers(env(), request);
    const [offer] = await client.collect(target('amazon'));
    await client.collect({ ...target('amazon'), mode: 'search', query: 'NVMe SSD' });
    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'test-client',
      client_secret: 'test-secret',
      scope: 'creatorsapi::default',
    });
    const [, init] = request.mock.calls[1];
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'x-marketplace': 'www.amazon.com',
    });
    const body = JSON.parse(String(init?.body));
    expect(body.itemIds).toEqual(['B012345678']);
    expect(body.resources).toContain('offersV2.listings.price');
    expect(init?.redirect).toBe('error');
    expect(offer).toMatchObject({ price: 8999, shipping: null, affiliate: true });
    expect(offer.expiresAt - offer.checkedAt).toBe(3600000);
    expect(offer).not.toHaveProperty('discount');
    expect(offer).not.toHaveProperty('baseline');
    expect(offer).not.toHaveProperty('savingBasis');
    expect(offer).not.toHaveProperty('savings');
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toMatchObject({
      keywords: 'NVMe SSD',
      itemCount: 10,
    });
  });
  it('renews expiring Amazon tokens', async () => {
    vi.useFakeTimers();
    const request = amazonFetch(),
      client = new AmazonOffers(env(), request);
    await client.collect(target('amazon'));
    vi.advanceTimersByTime(3550000);
    await client.collect(target('amazon'));
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('suppresses Amazon MAP, used, missing stock, subscriptions and membership offers', async () => {
    for (const change of [
      { violatesMAP: true },
      { violatesMAP: undefined },
      { condition: { value: 'Used' } },
      { availability: undefined },
      { availability: { type: 'PREORDER' } },
      { type: 'SUBSCRIBE_AND_SAVE' },
      { dealDetails: { accessType: 'PRIME_EXCLUSIVE' } },
      { dealDetails: { endTime: '2000-01-01T00:00:00Z' } },
      { price: { money: { amount: 10, currency: 'EUR' } } },
    ]) {
      const request = amazonFetch(amazonItem({ ...listing(), ...change } as any));
      expect(await new AmazonOffers(env(), request).collect(target('amazon'))).toEqual([]);
    }
  });
  it('rejects Amazon identity and affiliate substitutions, including duplicate tags', async () => {
    for (const change of [
      { asin: 'B099999999' },
      { detailPageURL: 'https://www.amazon.com/dp/B012345678?tag=other-20' },
      { detailPageURL: 'https://www.amazon.com/dp/B012345678?tag=test-20&tag=other-20' },
      { detailPageURL: 'https://www.amazon.com.evil.example/dp/B012345678?tag=test-20' },
    ]) {
      await expect(
        new AmazonOffers(env(), amazonFetch({ ...amazonItem(), ...change })).collect(
          target('amazon'),
        ),
      ).rejects.toMatchObject({ code: 'invalid' });
    }
  });
  it('bounds Amazon cache expiry to a promotion end and supports the documented container alias', async () => {
    const endTime = new Date(Date.now() + 900000).toISOString();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        Response.json({
          itemResults: {
            items: [
              amazonItem({ ...listing(), dealDetails: { accessType: 'ALL', endTime } } as any),
            ],
          },
        }),
      );
    const [offer] = await new AmazonOffers(env(), request).collect(target('amazon'));
    expect(offer.expiresAt).toBe(Date.parse(endTime));
  });
  it('uses Best Buy exact SKU and current price, preserving unknown shipping', async () => {
    const request = bestbuyFetch({ ...bestbuyItem(), shippingCost: undefined } as any);
    const [offer] = await new BestBuyOffers(env(), request).collect(target('bestbuy'));
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.hostname).toBe('api.bestbuy.com');
    expect(decodeURIComponent(url.pathname)).toContain('sku in(1234567)');
    expect(url.searchParams.get('IPID')).toBe(null);
    expect(offer).toMatchObject({ price: 8999, shipping: null, affiliate: false });
    expect(offer.url).toBe(bestbuyItem().url);
    expect(offer).not.toHaveProperty('discount');
  });
  it('requests account-specific Best Buy links only for configured Impact partners and exact hosts', async () => {
    const e = {
        ...env(),
        BESTBUY_IMPACT_PARTNER_ID: '123',
        BESTBUY_AFFILIATE_HOSTS: 'approved.example',
      },
      request = bestbuyFetch();
    expect((await new BestBuyOffers(e, request).collect(target('bestbuy')))[0]).toMatchObject({
      affiliate: true,
      affiliateAccount: '123',
      url: bestbuyItem().affiliateUrl,
    });
    expect(new URL(String(request.mock.calls[0][0])).searchParams.get('IPID')).toBe('123');
    await expect(
      new BestBuyOffers(
        { ...e, BESTBUY_AFFILIATE_HOSTS: 'different.example' },
        bestbuyFetch(),
      ).collect(target('bestbuy')),
    ).rejects.toMatchObject({ code: 'invalid' });
  });
  it('does not substitute Best Buy identities or assume missing availability', async () => {
    await expect(
      new BestBuyOffers(env(), bestbuyFetch({ ...bestbuyItem(), sku: 9999999 })).collect(
        target('bestbuy'),
      ),
    ).rejects.toMatchObject({ code: 'invalid' });
    for (const change of [
      { active: false },
      { onlineAvailability: undefined },
      { condition: 'Refurbished' },
    ])
      expect(
        await new BestBuyOffers(
          env(),
          bestbuyFetch({ ...bestbuyItem(), ...change } as any),
        ).collect(target('bestbuy')),
      ).toEqual([]);
  });
  it('validates queries before sending requests and encodes Best Buy keyword filters', async () => {
    for (const query of ['ssd)&salePrice<100', 'ssd?apiKey=secret', 'https://example.com'])
      expect(targetSchema.safeParse({ ...target('bestbuy'), mode: 'search', query }).success).toBe(
        false,
      );
    expect(targetSchema.safeParse({ ...target('bestbuy'), query: ',' }).success).toBe(false);
    const request = bestbuyFetch();
    await new BestBuyOffers(env(), request).collect({
      ...target('bestbuy'),
      mode: 'search',
      query: 'NVMe SSD',
    });
    expect(decodeURIComponent(new URL(String(request.mock.calls[0][0])).pathname)).toContain(
      'search=NVMe&search=SSD',
    );
  });
  it('classifies HTTP failures and never leaks remote URLs, bodies or credentials', async () => {
    for (const [status, code] of [
      [429, 'rate-limit'],
      [401, 'auth'],
      [403, 'auth'],
      [503, 'temporary'],
    ] as const) {
      await expect(
        new BestBuyOffers(
          env(),
          vi
            .fn()
            .mockResolvedValue(
              new Response('SECRET remote body', { status, headers: { 'Retry-After': '7200' } }),
            ),
        ).collect(target('bestbuy')),
      ).rejects.toMatchObject({ code, retryAfter: 7200000 });
    }
    await expect(
      new BestBuyOffers(
        env(),
        vi.fn().mockRejectedValue(new Error('SECRET apiKey=secret')),
      ).collect(target('bestbuy')),
    ).rejects.toMatchObject({ message: 'Provider temporary; retry after the provider cooldown' });
  });
});

async function configured(autoPublish = true) {
  const context = await setup(true);
  Object.assign(context.env, credentials);
  await context.db.prepare("UPDATE data_providers SET enabled=1 WHERE id='bestbuy'").run();
  await addRetailerTarget(context.env, target('bestbuy', autoPublish));
  return context;
}
describe('retailer discovery and cache boundaries', () => {
  it('leaves new providers disabled and never fetches in demo or without credentials', async () => {
    const { env: e, db } = await setup();
    const request = bestbuyFetch();
    await addRetailerTarget(e, target('bestbuy'));
    await collectRetailerOffers(e, request);
    e.APP_MODE = 'production';
    await collectRetailerOffers(e, request);
    expect(request).not.toHaveBeenCalled();
    expect(
      db.sql.prepare("SELECT enabled FROM data_providers WHERE id='amazon'").get()?.enabled,
    ).toBe(0);
    db.close();
  });
  it('automatically discovers and publishes fresh offers without creating historical observations or social jobs', async () => {
    const { env: e, db } = await configured();
    const before = db.sql.prepare('SELECT COUNT(*) n FROM price_observations').get()?.n;
    expect(await collectRetailerOffers(e, bestbuyFetch())).toEqual({ checked: 1, offers: 1 });
    expect((await publicRetailerOffers(e))[0].price).toBe(8999);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM price_observations').get()?.n).toBe(before);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM social_publishing_jobs').get()?.n).toBe(0);
    expect((await getSettings(e.DB)).postingMode).toBe('manual');
    db.close();
  });
  it('requires manual review unless automatic website publishing was selected; preserves approval on refresh', async () => {
    const { env: e, db } = await configured(false);
    await collectRetailerOffers(e, bestbuyFetch());
    expect(await publicRetailerOffers(e)).toEqual([]);
    await db.prepare('UPDATE retailer_offer_cache SET approved=1').run();
    await db.prepare('UPDATE retailer_targets SET next_check_at=0').run();
    await db.prepare('UPDATE data_providers SET paused_until=0').run();
    await collectRetailerOffers(e, bestbuyFetch({ ...bestbuyItem(), salePrice: 79.99 }));
    expect((await publicRetailerOffers(e))[0].price).toBe(7999);
    db.close();
  });
  it('removes unavailable products on refresh and hides offers when their source or category is disabled', async () => {
    const { env: e, db } = await configured();
    await collectRetailerOffers(e, bestbuyFetch());
    await db.prepare("UPDATE categories SET enabled=0 WHERE id='storage'").run();
    expect(await publicRetailerOffers(e)).toEqual([]);
    await db.prepare("UPDATE categories SET enabled=1 WHERE id='storage'").run();
    await db.prepare("UPDATE data_providers SET enabled=0 WHERE id='bestbuy'").run();
    expect(await publicRetailerOffers(e)).toEqual([]);
    await db.prepare("UPDATE data_providers SET enabled=1,paused_until=0 WHERE id='bestbuy'").run();
    await db.prepare('UPDATE retailer_targets SET next_check_at=0').run();
    await collectRetailerOffers(e, bestbuyFetch({ ...bestbuyItem(), onlineAvailability: false }));
    expect(await publicRetailerOffers(e)).toEqual([]);
    expect(db.sql.prepare('SELECT COUNT(*) n FROM retailer_offer_cache').get()?.n).toBe(0);
    db.close();
  });
  it('purges expired cached content even when monitoring is stopped', async () => {
    const { env: e, db } = await configured();
    await collectRetailerOffers(e, bestbuyFetch());
    await saveSettings(e.DB, { ...(await getSettings(e.DB)), monitoringEnabled: false });
    vi.useFakeTimers();
    vi.advanceTimersByTime(3600001);
    expect(await publicRetailerOffers(e)).toEqual([]);
    const request = bestbuyFetch();
    await collectRetailerOffers(e, request);
    expect(request).not.toHaveBeenCalled();
    expect(db.sql.prepare('SELECT COUNT(*) n FROM retailer_offer_cache').get()?.n).toBe(0);
    db.close();
  });
  it('hides links immediately if the Impact account changes and removes content if access is revoked', async () => {
    const { env: e, db } = await configured();
    e.BESTBUY_IMPACT_PARTNER_ID = '123';
    e.BESTBUY_AFFILIATE_HOSTS = 'approved.example';
    await collectRetailerOffers(e, bestbuyFetch());
    expect(await publicRetailerOffers(e)).toHaveLength(1);
    e.BESTBUY_IMPACT_PARTNER_ID = '456';
    expect(await publicRetailerOffers(e)).toEqual([]);
    e.BESTBUY_API_APPROVED = 'false';
    await collectRetailerOffers(e, bestbuyFetch());
    expect(db.sql.prepare('SELECT COUNT(*) n FROM retailer_offer_cache').get()?.n).toBe(0);
    db.close();
  });
  it('respects provider cooldown and disables authentication failures without logging secrets', async () => {
    const { env: e, db } = await configured();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('SECRET', { status: 429, headers: { 'Retry-After': '7200' } }),
      );
    await collectRetailerOffers(e, request);
    await collectRetailerOffers(e, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      db.sql.prepare("SELECT paused_until FROM data_providers WHERE id='bestbuy'").get()
        ?.paused_until,
    ).toBeGreaterThan(Date.now() + 7000000);
    await db.prepare('UPDATE retailer_targets SET next_check_at=0').run();
    await db.prepare('UPDATE data_providers SET paused_until=0').run();
    await collectRetailerOffers(
      e,
      vi.fn().mockResolvedValue(new Response('SECRET', { status: 401 })),
    );
    expect(
      db.sql.prepare("SELECT enabled FROM data_providers WHERE id='bestbuy'").get()?.enabled,
    ).toBe(0);
    expect(JSON.stringify(db.sql.prepare('SELECT * FROM error_logs').all())).not.toContain(
      'SECRET',
    );
    db.close();
  });
  it('bounds work to one search per retailer and respects the distributed lock', async () => {
    const { env: e, db } = await configured();
    await addRetailerTarget(e, { ...target('bestbuy'), mode: 'search', query: 'SSD' });
    const request = bestbuyFetch();
    await db
      .prepare('INSERT INTO distributed_locks VALUES (?,?,?)')
      .bind('retailer-offers', 'other', Date.now() + 120000)
      .run();
    expect(await collectRetailerOffers(e, request)).toEqual({ checked: 0, offers: 0 });
    await db.prepare('DELETE FROM distributed_locks').run();
    await collectRetailerOffers(e, request);
    expect(request).toHaveBeenCalledTimes(1);
    db.close();
  });
  it('rejects retailer API content in permanent history imports', async () => {
    const { env: e, db } = await configured();
    await expect(
      importListings(e, [fixture({ provider: 'bestbuy', retailer: 'bestbuy', demo: false })]),
    ).rejects.toThrow('temporary display cache');
    db.close();
  });
});
