import { defineMiddleware } from 'astro:middleware';
import { runtime } from './lib/runtime';
import { authenticate, csrfValid, rateLimit } from './lib/security/auth';
export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname,
    admin = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/');
  if (admin && path !== '/admin/login' && path !== '/api/admin/login') {
    const e = runtime(),
      auth = await authenticate(context.request, e, import.meta.env.DEV);
    if (!auth)
      return path.startsWith('/api/')
        ? Response.json({ error: 'Administrator authentication required' }, { status: 401 })
        : context.redirect('/admin/login');
    context.locals.actor = auth.actor;
    context.locals.csrf = auth.csrf;
    if (!['GET', 'HEAD'].includes(context.request.method) && !csrfValid(context.request, auth.csrf))
      return Response.json({ error: 'Invalid origin or CSRF token' }, { status: 403 });
    if (!(await rateLimit(e.DB, `admin:${auth.actor}`, 40)))
      return Response.json({ error: 'Too many admin requests; wait a minute' }, { status: 429 });
  }
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  if (context.url.protocol === 'https:')
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (admin) {
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return response;
});
