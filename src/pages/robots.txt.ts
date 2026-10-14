import type { APIRoute } from 'astro';
import { runtime } from '../lib/runtime';
export const GET: APIRoute = () => {
  const e = runtime();
  return new Response(
    e.APP_MODE === 'demo'
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /search\nDisallow: /*?\nSitemap: ${new URL('/sitemap.xml', e.SITE_URL).href}\n`,
    { headers: { 'Content-Type': 'text/plain' } },
  );
};
