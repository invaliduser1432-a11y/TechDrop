import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { authenticate } from '../../src/lib/security/auth';
import type { Env } from '../../src/lib/types';

// Only the JWKS HTTP response is simulated; real JOSE signatures and claim checks run.
const team = 'dealradar-auth-test.cloudflareaccess.com';
const issuer = `https://${team}`;
const audience = 'test-access-audience';
const email = 'invaliduser1432@gmail.com';
const env = {
  APP_MODE: 'production',
  ALLOW_LOCAL_ADMIN: 'false',
  ACCESS_TEAM_DOMAIN: team,
  ACCESS_AUD: audience,
  ADMIN_EMAILS: email,
} as Env;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'access-test', alg: 'RS256' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(String(url)).toBe(`${issuer}/cdn-cgi/access/certs`);
      return Response.json({ keys: [jwk] });
    }),
  );
});
afterAll(() => vi.unstubAllGlobals());

async function token(overrides: Record<string, unknown> = {}, key?: CryptoKey) {
  return new SignJWT({
    iss: issuer,
    aud: audience,
    sub: 'access-test-user',
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'access-test' })
    .sign(key ?? privateKey);
}
function request(assertion?: string) {
  return new Request('https://site.example/admin', {
    headers: assertion ? { 'cf-access-jwt-assertion': assertion } : {},
  });
}

describe('Cloudflare Access JWT boundary', () => {
  it('accepts a valid RS256 assertion for the exact administrator and application', async () => {
    const result = await authenticate(request(await token()), env);
    expect(result?.actor).toBe(email);
    expect(result?.csrf).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    ['another email', { email: 'other@example.com' }],
    ['email with an extra suffix', { email: `${email}.attacker.example` }],
    ['wrong audience', { aud: 'another-access-application' }],
    ['wrong issuer', { iss: 'https://another-team.cloudflareaccess.com' }],
    ['expired assertion', { exp: Math.floor(Date.now() / 1000) - 120 }],
  ])('rejects %s despite a valid signature', async (_label, claims) => {
    expect(await authenticate(request(await token(claims)), env)).toBe(null);
  });
  it('rejects a signature from an untrusted key', async () => {
    expect(await authenticate(request(await token({}, otherKey)), env)).toBe(null);
  });
  it('rejects malformed assertions and an email header without a JWT', async () => {
    expect(await authenticate(request('forged.jwt.signature'), env)).toBe(null);
    expect(
      await authenticate(
        new Request('https://site.example/admin', {
          headers: { 'cf-access-authenticated-user-email': email },
        }),
        env,
      ),
    ).toBe(null);
  });
});
