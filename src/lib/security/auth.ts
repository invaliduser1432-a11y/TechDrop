import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import type { Env } from '../types';
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export function localAdminAllowed(env: Env, url: URL, isDev: boolean) {
  return (
    isDev &&
    env.APP_MODE === 'demo' &&
    env.ALLOW_LOCAL_ADMIN === 'true' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    !!env.LOCAL_ADMIN_TOKEN &&
    env.LOCAL_ADMIN_TOKEN.length >= 32
  );
}
export async function localSession(secret: string) {
  return new SignJWT({ sub: 'local-admin', csrf: crypto.randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('dealradar-local')
    .setAudience('dealradar-admin')
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(new TextEncoder().encode(secret));
}
export async function authenticate(request: Request, env: Env, isDev = false) {
  const url = new URL(request.url);
  if (localAdminAllowed(env, url, isDev)) {
    const cookie = request.headers
      .get('cookie')
      ?.split('; ')
      .find((v) => v.startsWith('dr_admin='))
      ?.slice(9);
    if (cookie) {
      try {
        const { payload } = await jwtVerify(
          cookie,
          new TextEncoder().encode(env.LOCAL_ADMIN_TOKEN!),
          { algorithms: ['HS256'], issuer: 'dealradar-local', audience: 'dealradar-admin' },
        );
        return { actor: 'local-admin', csrf: String(payload.csrf) };
      } catch {
        /* fail closed */
      }
    }
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.ADMIN_EMAILS) return null;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN)) return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  try {
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    if (!jwks.has(issuer))
      jwks.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
    const { payload } = await jwtVerify(token, jwks.get(issuer)!, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ['RS256'],
    });
    if (
      typeof payload.email !== 'string' ||
      !env.ADMIN_EMAILS.split(',')
        .map((v) => v.trim())
        .includes(payload.email)
    )
      return null;
    // Signed access JWT binds CSRF material to this authenticated session.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return {
      actor: payload.email,
      csrf: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(''),
    };
  } catch {
    return null;
  }
}
export function csrfValid(request: Request, csrf: string) {
  return (
    request.headers.get('origin') === new URL(request.url).origin &&
    request.headers.get('x-csrf-token') === csrf
  );
}
export async function rateLimit(db: D1Database, key: string, limit = 30) {
  const window = Math.floor(Date.now() / 60000);
  const r = await db
    .prepare(
      'INSERT INTO rate_limit_buckets(key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN rate_limit_buckets.window=excluded.window THEN rate_limit_buckets.count+1 ELSE 1 END RETURNING count',
    )
    .bind(key, window)
    .first<{ count: number }>();
  return (r?.count ?? limit + 1) <= limit;
}
