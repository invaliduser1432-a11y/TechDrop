import type { APIRoute } from 'astro';
import { z } from 'zod';
import { runtime } from '../../lib/runtime';
import { rateLimit } from '../../lib/security/auth';
export const POST: APIRoute = async ({ request, url }) => {
  if (request.headers.get('origin') !== url.origin) return new Response(null, { status: 403 });
  const e = runtime();
  // Hash IP only for an ephemeral rate-limit bucket; no address or persistent identifier enters analytics.
  const address = request.headers.get('cf-connecting-ip') ?? 'local';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${address}:${Math.floor(Date.now() / 60000)}`),
  );
  const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (!(await rateLimit(e.DB, `click:${key}`, 20))) return new Response(null, { status: 429 });
  const body = z
    .object({
      dealId: z.string().max(100),
      source: z.enum(['website', 'social']).default('website'),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  const row = await e.DB.prepare(
    "SELECT d.id,r.name retailer FROM deals d JOIN product_listings l ON l.id=d.listing_id JOIN retailers r ON r.id=l.retailer_id WHERE d.id=? AND d.status='active' AND l.demo=? AND l.available=1 AND l.checked_at>=?",
  )
    .bind(body.data.dealId, e.APP_MODE === 'demo' ? 1 : 0, Date.now() - 120 * 60000)
    .first<{ id: string; retailer: string }>();
  if (!row) return new Response(null, { status: 404 });
  await e.DB.prepare('INSERT INTO affiliate_click_events VALUES (?,?,?,?,?)')
    .bind(crypto.randomUUID(), row.id, row.retailer, body.data.source, Date.now())
    .run();
  return new Response(null, { status: 204 });
};
