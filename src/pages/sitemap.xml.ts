import type { APIRoute } from 'astro';
import { runtime } from '../lib/runtime';
import { publicDeals } from '../lib/db/repository';
const escape = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export const GET: APIRoute = async () => {
  const e = runtime();
  const deals = e.APP_MODE === 'demo' ? [] : await publicDeals(e, { limit: 500 });
  const cats = [...new Set(deals.map((d) => d.category_id))];
  const urls =
    e.APP_MODE === 'demo'
      ? []
      : [
          '/',
          '/deals',
          '/offers',
          '/categories',
          '/price-history',
          '/methodology',
          '/affiliate-disclosure',
          '/privacy',
          ...cats.map((c) => `/categories/${c}`),
          ...deals.map((d) => `/deals/${d.slug}`),
        ];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((p) => `<url><loc>${escape(new URL(p, e.SITE_URL).href)}</loc></url>`).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
};
