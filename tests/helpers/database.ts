import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import type { Env, Listing, Observation } from '../../src/lib/types';
import { importListings } from '../../src/lib/providers/import';
import { defaults, saveSettings } from '../../src/lib/config';
export class TestDatabase {
  sql = new DatabaseSync(':memory:');
  constructor() {
    for (const file of readdirSync('migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort())
      this.sql.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  prepare(query: string) {
    const database = this.sql;
    let args: any[] = [];
    const s = {
      bind(...values: any[]) {
        args = values;
        return s;
      },
      async first<T = any>(column?: string) {
        const row = database.prepare(query).get(...args);
        return row ? ((column ? row[column] : row) as T) : null;
      },
      async all<T = any>() {
        return { results: database.prepare(query).all(...args) as T[], success: true };
      },
      async run() {
        const r = database.prepare(query).run(...args);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
    };
    return s;
  }
  async batch(statements: any[]) {
    this.sql.exec('BEGIN');
    try {
      const out = [];
      for (const s of statements) out.push(await s.run());
      this.sql.exec('COMMIT');
      return out;
    } catch (error) {
      this.sql.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.sql.close();
  }
}
export const now = Date.now();
export function fixture(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'ssd',
    productId: 'ssd',
    externalId: 'ssd',
    provider: 'mock',
    retailer: 'demo',
    name: 'Atlas 2TB NVMe SSD',
    brand: 'Atlas',
    model: 'N2',
    variant: '2TB',
    category: 'storage',
    condition: 'new',
    currency: 'USD',
    price: 8900,
    shipping: 0,
    originalUrl: 'https://example.com/demo/ssd',
    imagePermitted: false,
    available: true,
    demo: true,
    checkedAt: Date.now(),
    identityKey: 'ssd|Atlas|N2|2TB|new|USD',
    sellerConfidence: 1,
    ...overrides,
  };
}
export function history(l = fixture(), days = 35): Observation[] {
  return Array.from({ length: days }, (_, i) => ({
    listingId: l.id,
    price: 12500,
    shipping: 0,
    currency: 'USD',
    at: l.checkedAt - (i + 1) * 86400000,
    identityKey: l.identityKey,
    source: l.provider,
  }));
}
export async function setup(production = false) {
  const db = new TestDatabase();
  const env: Env = {
    DB: db as unknown as D1Database,
    APP_MODE: production ? 'production' : 'demo',
    SITE_URL: 'https://dealradar.example',
    BUFFER_TOKEN: production ? 'test-only-token' : undefined,
    LIVE_PUBLISHING_ALLOWED: production ? 'true' : 'false',
  };
  await db.prepare('INSERT INTO categories(id,name) VALUES (?,?)').bind('storage', 'Storage').run();
  const listing = fixture({ demo: !production, provider: production ? 'feed' : 'mock' });
  await importListings(env, [listing]);
  for (const o of history(listing))
    await db
      .prepare(
        'INSERT INTO price_observations(listing_id,price_cents,shipping_cents,currency,observed_at,source,identity_key) VALUES (?,?,?,?,?,?,?)',
      )
      .bind(o.listingId, o.price, o.shipping, o.currency, o.at, o.source, o.identityKey)
      .run();
  await saveSettings(env.DB, {
    ...defaults,
    postingMode: 'manual',
    accountEligible: true,
    channelId: 'x-123',
    organizationId: 'org-123',
  });
  return { db, env, listing };
}
