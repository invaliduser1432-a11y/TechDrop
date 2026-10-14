import type { Env } from '../types';
import { ProviderError } from './interface';
let cached: { clientId: string; token: string; expires: number } | undefined;
export async function ebayToken(env: Env, request: typeof fetch = fetch) {
  if (env.EBAY_ACCESS_TOKEN) return env.EBAY_ACCESS_TOKEN;
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new ProviderError('auth');
  if (cached?.clientId === env.EBAY_CLIENT_ID && cached.expires > Date.now() + 60000)
    return cached.token;
  const response = await request('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 429) throw new ProviderError('rate-limit');
  if (response.status === 400 || response.status === 401 || response.status === 403)
    throw new ProviderError('auth');
  if (!response.ok) throw new ProviderError('temporary');
  const body: any = await response.json();
  if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number')
    throw new ProviderError('invalid');
  cached = {
    clientId: env.EBAY_CLIENT_ID,
    token: body.access_token,
    expires: Date.now() + body.expires_in * 1000,
  };
  return cached.token;
}
