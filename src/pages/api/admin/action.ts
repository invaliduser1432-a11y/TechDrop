import type { APIRoute } from 'astro';
import { z } from 'zod';
import { runtime } from '../../../lib/runtime';
import { getSettings, saveSettings, settingsSchema } from '../../../lib/config';
import { audit, dealSelect, getListing, observations } from '../../../lib/db/repository';
import { scoreDeal } from '../../../lib/price/scoring';
import { monitor, evaluate } from '../../../lib/jobs/monitor';
import {
  createLocalDraft,
  approveDraft,
  runPublishing,
  reconcile,
} from '../../../lib/social/queue';
import { BufferClient } from '../../../lib/social/buffer';
import { parseFeed } from '../../../lib/providers/feed';
import { importListings } from '../../../lib/providers/import';
import { EbayProvider } from '../../../lib/providers/ebay';
import { purchaseUrl } from '../../../lib/affiliate/links';
const id = z.string().min(1).max(200);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings'), value: settingsSchema }),
  z.object({ action: z.enum(['stop', 'monitor', 'publishing', 'buffer-channels', 'logout']) }),
  z.object({
    action: z.enum([
      'approve',
      'reject',
      'feature',
      'recheck',
      'draft',
      'approve-draft',
      'reconcile',
    ]),
    id,
  }),
  z.object({
    action: z.literal('category'),
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    name: z.string().min(1).max(100),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal('provider'),
    id: z.enum(['mock', 'ebay', 'feed']),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal('retailer'),
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(80),
    name: z.string().min(1).max(100),
    hosts: z.array(z.string()).min(1).max(10),
  }),
  z.object({
    action: z.literal('import'),
    format: z.enum(['csv', 'json']),
    text: z.string().max(1000000),
    retailer: id,
    provider: z.enum(['feed', 'ebay']).default('feed'),
    authorized: z.literal(true),
  }),
  z.object({ action: z.literal('affiliate'), id, url: z.url().nullable() }),
  z.object({
    action: z.literal('revenue'),
    retailer: id,
    amount: z.number().int().min(0),
    reference: z.string().min(1).max(200),
  }),
]);
export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const env = runtime();
  if (Number(request.headers.get('content-length') ?? 0) > 1100000)
    return Response.json({ error: 'Request exceeds 1 MB' }, { status: 413 });
  let text: string;
  try {
    text = await request.text();
  } catch {
    return Response.json({ error: 'Unreadable request' }, { status: 400 });
  }
  if (text.length > 1100000) return Response.json({ error: 'Request too large' }, { status: 413 });
  let decoded: unknown;
  try {
    decoded = JSON.parse(text || '{}');
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  const body = parsed.data;
  try {
    let result: unknown = { ok: true };
    switch (body.action) {
      case 'logout':
        cookies.delete('dr_admin', { path: '/' });
        break;
      case 'settings': {
        const previous = await getSettings(env.DB);
        if (body.value.postingMode !== 'disabled' && env.APP_MODE === 'production') {
          if (
            env.LIVE_PUBLISHING_ALLOWED !== 'true' ||
            !env.BUFFER_TOKEN ||
            !body.value.accountEligible
          )
            throw new Error(
              'Configure server authorization and confirm account eligibility before activation',
            );
          await new BufferClient(env.BUFFER_TOKEN).ensureXChannel(
            body.value.organizationId,
            body.value.channelId,
          );
        }
        await saveSettings(env.DB, body.value);
        if (previous.channelId !== body.value.channelId)
          await env.DB.prepare(
            "UPDATE social_publishing_jobs SET state='cancelled',error='Channel changed' WHERE state IN ('pending','retry')",
          ).run();
        break;
      }
      case 'stop':
        await saveSettings(env.DB, {
          ...(await getSettings(env.DB)),
          postingMode: 'disabled',
          monitoringEnabled: false,
        });
        await env.DB.prepare(
          "UPDATE social_publishing_jobs SET state='cancelled' WHERE state IN ('pending','retry','remote-draft')",
        ).run();
        result = {
          ok: true,
          message:
            'Monitoring and new publishing stopped. Pause the Buffer channel to stop posts already scheduled there.',
        };
        break;
      case 'monitor':
        result = await monitor(env, undefined, `manual:${crypto.randomUUID()}`);
        break;
      case 'publishing':
        result = await runPublishing(env);
        break;
      case 'buffer-channels': {
        if (env.APP_MODE === 'demo') {
          result = {
            organizations: [{ id: 'demo-org', name: 'Simulated organization' }],
            channels: [{ id: 'demo-x', name: '@dealradar_demo', service: 'twitter' }],
            simulated: true,
          };
          break;
        }
        if (!env.BUFFER_TOKEN) throw new Error('Set BUFFER_TOKEN as a server secret');
        const client = new BufferClient(env.BUFFER_TOKEN),
          s = await getSettings(env.DB),
          orgs = (await client.organizations()).account.organizations;
        result = {
          organizations: orgs,
          channels: s.organizationId ? await client.channels(s.organizationId) : [],
        };
        break;
      }
      case 'approve': {
        const deal = await env.DB.prepare('SELECT * FROM deals WHERE id=?')
            .bind(body.id)
            .first<any>(),
          listing = deal ? await getListing(env.DB, deal.listing_id) : null;
        if (!deal || !listing || listing.demo !== (env.APP_MODE === 'demo'))
          throw new Error('Deal not found in this environment');
        const last = await env.DB.prepare(
          'SELECT MAX(published_at) last FROM deals WHERE listing_id=? AND id<>?',
        )
          .bind(listing.id, deal.id)
          .first<{ last: number | null }>();
        const s = await getSettings(env.DB),
          r = scoreDeal(listing, await observations(env.DB, listing.id), s, last?.last ?? null);
        if (!r.qualified || r.current !== deal.current_cents || r.baseline !== deal.baseline_cents)
          throw new Error('Deal no longer qualifies. Recheck and inspect its history.');
        await env.DB.prepare(
          "UPDATE deals SET status='active',published_at=? WHERE id=? AND status='review'",
        )
          .bind(Date.now(), body.id)
          .run();
        break;
      }
      case 'reject':
        await env.DB.prepare("UPDATE deals SET status='rejected' WHERE id=?").bind(body.id).run();
        break;
      case 'feature':
        await env.DB.prepare('UPDATE deals SET featured=1-featured WHERE id=?').bind(body.id).run();
        break;
      case 'recheck':
        result = await monitor(env, body.id, `recheck:${crypto.randomUUID()}`);
        break;
      case 'draft':
        result = await createLocalDraft(env, body.id);
        break;
      case 'approve-draft':
        await approveDraft(env, body.id);
        break;
      case 'reconcile':
        result = await reconcile(env, body.id);
        break;
      case 'category':
        await env.DB.prepare(
          'INSERT INTO categories(id,name,enabled) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled',
        )
          .bind(body.id, body.name, +body.enabled)
          .run();
        break;
      case 'provider':
        if (body.id === 'mock' && env.APP_MODE === 'production')
          throw new Error('Mock provider is disabled in production');
        await env.DB.prepare('UPDATE data_providers SET enabled=?,paused_until=0 WHERE id=?')
          .bind(+body.enabled, body.id)
          .run();
        break;
      case 'retailer': {
        const allowed = (env.FEED_HOSTS ?? '').split(',').map((v) => v.trim());
        if (body.hosts.some((h) => !allowed.includes(h)))
          throw new Error('Retailer hosts must first be authorized in server FEED_HOSTS');
        await env.DB.prepare(
          'INSERT INTO retailers(id,name,allowed_hosts,affiliate_hosts) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,allowed_hosts=excluded.allowed_hosts',
        )
          .bind(body.id, body.name, JSON.stringify(body.hosts), JSON.stringify(body.hosts))
          .run();
        break;
      }
      case 'import': {
        const retailer = await env.DB.prepare('SELECT * FROM retailers WHERE id=?')
          .bind(body.retailer)
          .first<any>();
        if (!retailer) throw new Error('Create an authorized retailer first');
        if (env.APP_MODE !== 'production')
          throw new Error(
            'Real feed imports require production mode; demo seeding uses the local seed command',
          );
        let listings = parseFeed(
          body.text,
          body.format,
          body.retailer,
          JSON.parse(retailer.allowed_hosts),
          JSON.parse(retailer.affiliate_hosts),
        );
        if (body.provider === 'ebay') {
          if (body.retailer !== 'ebay') throw new Error('eBay listings require the eBay retailer');
          const provider = new EbayProvider(env);
          const refreshed = [];
          for (const l of listings) {
            const listing = {
              ...l,
              id: `ebay-${l.externalId}`,
              productId: l.productId,
              provider: 'ebay',
            };
            refreshed.push(await provider.refresh(listing));
          }
          listings = refreshed;
        }
        await importListings(env, listings);
        for (const l of listings) await evaluate(env, l);
        result = { imported: listings.length };
        break;
      }
      case 'affiliate': {
        const l = await getListing(env.DB, body.id);
        if (!l) throw new Error('Listing not found');
        const retailer = await env.DB.prepare('SELECT * FROM retailers WHERE id=?')
          .bind(l.retailer)
          .first<any>();
        purchaseUrl(
          l.originalUrl,
          body.url,
          JSON.parse(retailer.allowed_hosts),
          JSON.parse(retailer.affiliate_hosts),
        );
        await env.DB.prepare('UPDATE product_listings SET affiliate_url=? WHERE id=?')
          .bind(body.url, body.id)
          .run();
        break;
      }
      case 'revenue':
        await env.DB.prepare("INSERT INTO verified_revenue VALUES (?,?,?,'USD',?,?)")
          .bind(crypto.randomUUID(), body.retailer, body.amount, Date.now(), body.reference)
          .run();
        break;
    }
    await audit(env.DB, locals.actor!, body.action, 'id' in body ? body.id : '');
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed';
    return Response.json(
      {
        error:
          message.startsWith('D1') || message.includes('SQL')
            ? 'Database operation failed; check System Health'
            : message.slice(0, 300),
      },
      { status: 400 },
    );
  }
};
export const GET: APIRoute = async () => {
  const env = runtime();
  return Response.json({
    settings: await getSettings(env.DB),
    deals: (await env.DB.prepare(`${dealSelect} ORDER BY d.detected_at DESC LIMIT 100`).all())
      .results,
  });
};
