import { env } from 'cloudflare:workers';
import type { Env } from './types';
export function runtime(): Env {
  const e = env as unknown as Env;
  if (!e.DB || !['demo', 'production'].includes(e.APP_MODE) || !e.SITE_URL)
    throw new Error('Server configuration incomplete: bind DB, APP_MODE and SITE_URL');
  const url = new URL(e.SITE_URL);
  if (e.APP_MODE === 'production' && url.protocol !== 'https:')
    throw new Error('Production SITE_URL requires HTTPS');
  return e;
}
