import type { APIRoute } from 'astro';
import { runtime } from '../../../lib/runtime';
import { localAdminAllowed, localSession, rateLimit } from '../../../lib/security/auth';
export const POST: APIRoute = async ({ request, url, cookies }) => {
  const env = runtime();
  if (!localAdminAllowed(env, url, import.meta.env.DEV))
    return Response.json(
      { error: 'Use Cloudflare Access for deployed administration' },
      { status: 403 },
    );
  if (request.headers.get('origin') !== url.origin) return new Response(null, { status: 403 });
  if (!(await rateLimit(env.DB, 'local-login', 5)))
    return Response.json({ error: 'Wait one minute before another attempt' }, { status: 429 });
  const body: any = await request.json().catch(() => ({}));
  const supplied = new TextEncoder().encode(String(body.token ?? '')),
    expected = new TextEncoder().encode(env.LOCAL_ADMIN_TOKEN!);
  const a = await crypto.subtle.digest('SHA-256', supplied),
    b = await crypto.subtle.digest('SHA-256', expected);
  let diff = 0;
  new Uint8Array(a).forEach((v, i) => (diff |= v ^ new Uint8Array(b)[i]));
  if (diff) return Response.json({ error: 'Invalid local admin token' }, { status: 401 });
  cookies.set('dr_admin', await localSession(env.LOCAL_ADMIN_TOKEN!), {
    httpOnly: true,
    sameSite: 'strict',
    secure: url.protocol === 'https:',
    path: '/',
    maxAge: 28800,
  });
  return Response.json({ ok: true });
};
