import { describe, it, expect, vi } from 'vitest';
import { safeExternalUrl, purchaseUrl } from '../../src/lib/affiliate/links';
import { parseFeed } from '../../src/lib/providers/feed';
import { BufferClient, BufferError } from '../../src/lib/social/buffer';
import { EbayProvider } from '../../src/lib/providers/ebay';
import { fixture } from '../helpers/database';
import {
  authenticate,
  csrfValid,
  localAdminAllowed,
  localSession,
} from '../../src/lib/security/auth';
import { defaults } from '../../src/lib/config';
import { publishingAllowed } from '../../src/lib/social/queue';
import type { Env } from '../../src/lib/types';
describe('authorized integration boundaries', () => {
  it('rejects unsafe and unapproved affiliate destinations', () => {
    for (const url of [
      'javascript:alert(1)',
      'https://ebay.com.evil.example/x',
      'http://www.ebay.com/x',
      'https://name:secret@www.ebay.com/x',
      'https://localhost/x',
    ])
      expect(() => safeExternalUrl(url, ['www.ebay.com'])).toThrow();
    expect(purchaseUrl('https://www.ebay.com/item', null, ['www.ebay.com'], [])).toBe(
      'https://www.ebay.com/item',
    );
  });
  it('imports cents-valued JSON and quoted CSV feeds with identity protection', () => {
    const row = {
      externalId: '1',
      name: 'Drive, 2TB',
      brand: 'Atlas',
      model: 'N2',
      variant: '2TB black',
      category: 'storage',
      condition: 'new',
      currency: 'USD',
      price: 8900,
      shipping: 0,
      originalUrl: 'https://example.com/p',
      available: true,
      imagePermitted: false,
    };
    const json = parseFeed(JSON.stringify([row]), 'json', 'demo', ['example.com'], []);
    expect(json[0].demo).toBe(false);
    const csv =
      'externalId,name,brand,model,variant,category,condition,currency,price,shipping,originalUrl,available\n1,"Drive, 2TB",Atlas,N2,2TB black,storage,new,USD,8900,0,https://example.com/p,true';
    expect(parseFeed(csv, 'csv', 'demo', ['example.com'], [])[0].name).toBe('Drive, 2TB');
    expect(() =>
      parseFeed(JSON.stringify([row, row]), 'json', 'demo', ['example.com'], []),
    ).toThrow('Duplicate');
  });
  it('blocks unauthenticated admin and production local-token bypasses', async () => {
    const env = {
      APP_MODE: 'production',
      ALLOW_LOCAL_ADMIN: 'true',
      LOCAL_ADMIN_TOKEN: 'x'.repeat(40),
    } as Env;
    expect(await authenticate(new Request('https://site.example/admin'), env)).toBe(null);
    expect(localAdminAllowed(env, new URL('http://localhost/admin'), true)).toBe(false);
  });
  it('verifies signed localhost session and rejects tampering', async () => {
    const env = {
      APP_MODE: 'demo',
      ALLOW_LOCAL_ADMIN: 'true',
      LOCAL_ADMIN_TOKEN: 'x'.repeat(40),
    } as Env;
    const session = await localSession(env.LOCAL_ADMIN_TOKEN!);
    expect(
      (
        await authenticate(
          new Request('http://localhost/admin', { headers: { cookie: `dr_admin=${session}` } }),
          env,
          true,
        )
      )?.actor,
    ).toBe('local-admin');
    expect(
      await authenticate(
        new Request('http://localhost/admin', { headers: { cookie: `dr_admin=${session}bad` } }),
        env,
        true,
      ),
    ).toBe(null);
  });
  it('requires same-origin CSRF and explicit live publishing gates', () => {
    expect(
      csrfValid(
        new Request('https://site.example/api', {
          method: 'POST',
          headers: { origin: 'https://evil.example', 'x-csrf-token': 'good' },
        }),
        'good',
      ),
    ).toBe(false);
    expect(
      publishingAllowed(
        { APP_MODE: 'demo', BUFFER_TOKEN: 'test', LIVE_PUBLISHING_ALLOWED: 'true' } as Env,
        {
          ...defaults,
          postingMode: 'automatic',
          accountEligible: true,
          channelId: 'x',
          organizationId: 'o',
        },
      ),
    ).toBe(false);
  });
  it('uses documented Buffer inputs to save drafts and schedule existing posts', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            createPost: {
              __typename: 'PostActionSuccess',
              post: { id: 'remote', status: 'draft' },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            editPost: {
              __typename: 'PostActionSuccess',
              post: { id: 'remote', status: 'scheduled' },
            },
          },
        }),
      );
    const b = new BufferClient('test', request);
    await b.createDraft('x', 'text #ad');
    await b.enqueue('remote', '2026-10-20T12:00:00Z');
    const first = JSON.parse(request.mock.calls[0][1].body),
      second = JSON.parse(request.mock.calls[1][1].body);
    expect(first.variables.input.saveToDraft).toBe(true);
    expect(first.variables.input.assets).toEqual([]);
    expect(second.variables.input.id).toBe('remote');
    expect(second.variables.input.mode).toBe('customScheduled');
  });
  it('classifies Buffer failures without leaking response text or tokens', async () => {
    for (const [status, kind] of [
      [429, 'rate-limit'],
      [401, 'auth'],
      [500, 'uncertain'],
    ] as const) {
      const b = new BufferClient(
        'SECRET',
        vi.fn().mockResolvedValue(new Response('SECRET', { status })),
      );
      await expect(b.createDraft('x', 'text')).rejects.toMatchObject({ kind });
    }
    const b = new BufferClient('SECRET', vi.fn().mockRejectedValue(new Error('SECRET')));
    await expect(b.createDraft('x', 'text')).rejects.toBeInstanceOf(BufferError);
  });
  it('rejects eBay listing identity changes and handles rate limits', async () => {
    const l = fixture({ provider: 'ebay', demo: false });
    const e = { EBAY_ACCESS_TOKEN: 'test' } as Env;
    await expect(
      new EbayProvider(
        e,
        vi.fn().mockResolvedValue(
          Response.json({
            itemId: 'other',
            title: l.name,
            conditionId: '1000',
            price: { currency: 'USD', value: '89' },
          }),
        ),
      ).refresh(l),
    ).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      new EbayProvider(e, vi.fn().mockResolvedValue(new Response(null, { status: 429 }))).refresh(
        l,
      ),
    ).rejects.toMatchObject({ code: 'rate-limit' });
  });
});

it('mints and reuses authorized eBay application tokens with documented scope', async () => {
  const { ebayToken } = await import('../../src/lib/providers/ebay-auth');
  const request = vi
    .fn()
    .mockResolvedValue(Response.json({ access_token: 'mock-application-token', expires_in: 7200 }));
  const env = { EBAY_CLIENT_ID: 'unit-client', EBAY_CLIENT_SECRET: 'unit-secret' } as Env;
  expect(await ebayToken(env, request)).toBe('mock-application-token');
  expect(await ebayToken(env, request)).toBe('mock-application-token');
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0][1].body)).toContain('grant_type=client_credentials');
});
