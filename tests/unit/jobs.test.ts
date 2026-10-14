import { describe, it, expect, vi, afterEach } from 'vitest';
import { setup, fixture, TestDatabase } from '../helpers/database';
import { evaluate, monitor } from '../../src/lib/jobs/monitor';
import { publicDeals } from '../../src/lib/db/repository';
import { MockProvider } from '../../src/lib/providers/mock';
import { createLocalDraft, approveDraft, runPublishing } from '../../src/lib/social/queue';
import { BufferClient } from '../../src/lib/social/buffer';
import { getSettings, saveSettings } from '../../src/lib/config';
afterEach(() => vi.restoreAllMocks());
async function approved(production = false) {
  const ctx = await setup(production);
  await evaluate(ctx.env, ctx.listing);
  const d: any = await ctx.db.prepare('SELECT * FROM deals').first();
  await ctx.db.prepare("UPDATE deals SET status='active' WHERE id=?").bind(d.id).run();
  await createLocalDraft(ctx.env, d.id);
  const draft: any = await ctx.db.prepare('SELECT * FROM social_post_drafts').first();
  await approveDraft(ctx.env, draft.id);
  return { ...ctx, deal: d, draft };
}
describe('durable monitoring and publishing', () => {
  it('runs relational migrations with foreign keys and duplicate constraints', async () => {
    const db = new TestDatabase();
    await expect(
      db
        .prepare(
          "INSERT INTO price_observations(listing_id,price_cents,shipping_cents,currency,observed_at,source,identity_key) VALUES ('missing',1,0,'USD',1,'mock','x')",
        )
        .run(),
    ).rejects.toThrow();
    db.close();
  });
  it('detects one review candidate and prevents duplicate evaluation', async () => {
    const { db, env, listing } = await setup();
    await evaluate(env, listing);
    await evaluate(env, listing);
    expect((await db.prepare('SELECT COUNT(*) count FROM deals').first<any>()).count).toBe(1);
    db.close();
  });
  it('removes unavailable and changed-price deals from public queries', async () => {
    const { db, env, listing } = await setup();
    await evaluate(env, listing);
    await db.prepare("UPDATE deals SET status='active'").run();
    expect(await publicDeals(env)).toHaveLength(1);
    vi.spyOn(MockProvider.prototype, 'refresh').mockImplementation(async (l) => ({
      ...l,
      available: false,
      checkedAt: Date.now(),
    }));
    await monitor(env, listing.id, 'stock-check');
    expect(await publicDeals(env)).toHaveLength(0);
    expect((await db.prepare('SELECT status FROM deals').first<any>()).status).toBe('expired');
    db.close();
  });
  it('safely retries scheduled jobs and does not repeat completed runs', async () => {
    const { db, env, listing } = await setup();
    await monitor(env, listing.id, 'run-1');
    const before = (await db.prepare('SELECT COUNT(*) count FROM price_observations').first<any>())
      .count;
    expect((await monitor(env, undefined, 'run-1')).duplicate).toBe(true);
    expect(
      (await db.prepare('SELECT COUNT(*) count FROM price_observations').first<any>()).count,
    ).toBe(before);
    db.close();
  });
  it('backs off a failed provider check without fabricating a observation', async () => {
    const { db, env, listing } = await setup();
    vi.spyOn(MockProvider.prototype, 'refresh').mockRejectedValue(new Error('secret response'));
    await monitor(env, listing.id, 'retry');
    const row: any = await db.prepare('SELECT * FROM product_listings').first();
    expect(row.failures).toBe(1);
    expect(row.next_check_at).toBeGreaterThan(Date.now());
    expect((await db.prepare('SELECT message FROM error_logs').first<any>()).message).not.toContain(
      'secret',
    );
    db.close();
  });
  it('generates #ad posts and simulates queue idempotently without live calls', async () => {
    const { db, env, draft } = await approved();
    expect(draft.text).toContain('#ad');
    expect(draft.text).toContain('$89.00');
    const remote = new BufferClient('test', vi.fn());
    expect((await runPublishing(env, remote)).sent).toBe(1);
    expect((await runPublishing(env, remote)).sent).toBe(0);
    expect((await db.prepare('SELECT state FROM social_publishing_jobs').first<any>()).state).toBe(
      'demo-queued',
    );
    db.close();
  });
  it('disabled mode never calls Buffer', async () => {
    const { db, env } = await approved(true);
    await saveSettings(env.DB, { ...(await getSettings(env.DB)), postingMode: 'disabled' });
    const request = vi.fn();
    expect((await runPublishing(env, new BufferClient('test', request))).disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
    db.close();
  });
  it('pauses on Buffer rate limits and preserves retry state', async () => {
    const { db, env } = await approved(true);
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            channels: [
              {
                id: 'x-123',
                service: 'twitter',
                isDisconnected: false,
                isLocked: false,
                isQueuePaused: false,
              },
            ],
          },
        }),
      )
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'retry-after': '120' } }));
    await runPublishing(env, new BufferClient('test', request));
    expect((await db.prepare('SELECT state FROM social_publishing_jobs').first<any>()).state).toBe(
      'retry',
    );
    expect((await getSettings(env.DB)).publishingPausedUntil).toBeGreaterThan(Date.now());
    db.close();
  });
  it('quarantines an ambiguous Buffer mutation and never auto-resends', async () => {
    const { db, env } = await approved(true);
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            channels: [
              {
                id: 'x-123',
                service: 'twitter',
                isDisconnected: false,
                isLocked: false,
                isQueuePaused: false,
              },
            ],
          },
        }),
      )
      .mockRejectedValue(new Error('timeout'));
    await runPublishing(env, new BufferClient('test', request));
    expect((await db.prepare('SELECT state FROM social_publishing_jobs').first<any>()).state).toBe(
      'uncertain',
    );
    const before = request.mock.calls.length;
    await runPublishing(env, new BufferClient('test', request));
    expect(request.mock.calls.length).toBe(before);
    db.close();
  });
  it('production refuses mock data imports and excludes seeded demo offers', async () => {
    const { db, env, listing } = await setup();
    await evaluate(env, listing);
    await db.prepare("UPDATE deals SET status='active'").run();
    expect(await publicDeals({ ...env, APP_MODE: 'production' })).toHaveLength(0);
    expect(fixture().demo).toBe(true);
    db.close();
  });
});

it('automatically approves website candidates only when intentionally configured', async () => {
  const { db, env, listing } = await setup();
  await saveSettings(env.DB, { ...(await getSettings(env.DB)), autoApproveDeals: true });
  await evaluate(env, listing);
  const deal: any = await db.prepare('SELECT * FROM deals').first();
  expect(deal.status).toBe('active');
  expect(deal.published_at).toBeGreaterThan(0);
  db.close();
});
it('enforces daily caps and minimum spacing across distinct deals', async () => {
  const { importListings } = await import('../../src/lib/providers/import');
  const { history } = await import('../helpers/database');
  const { db, env, draft } = await approved();
  const reserve = Date.now() + 3600000;
  await db
    .prepare(
      "INSERT INTO social_publishing_jobs(id,draft_id,idempotency_key,channel_id,state,scheduled_for) VALUES ('other',?,'other','demo-x','demo-queued',?)",
    )
    .bind(draft.id, reserve)
    .run();
  const next = fixture({
    id: 'next',
    productId: 'next',
    externalId: 'next',
    model: 'N3',
    identityKey: 'next|Atlas|N3|2TB|new|USD',
  });
  await importListings(env, [next]);
  for (const o of history(next))
    await db
      .prepare(
        'INSERT INTO price_observations(listing_id,price_cents,shipping_cents,currency,observed_at,source,identity_key) VALUES (?,?,?,?,?,?,?)',
      )
      .bind(o.listingId, o.price, o.shipping, o.currency, o.at, o.source, o.identityKey)
      .run();
  await evaluate(env, next);
  const deal: any = await db.prepare("SELECT * FROM deals WHERE listing_id='next'").first();
  await db.prepare("UPDATE deals SET status='active' WHERE id=?").bind(deal.id).run();
  await createLocalDraft(env, deal.id);
  const nextDraft: any = await db
    .prepare('SELECT id FROM social_post_drafts WHERE deal_id=?')
    .bind(deal.id)
    .first();
  await approveDraft(env, nextDraft.id);
  await saveSettings(env.DB, { ...(await getSettings(env.DB)), maxDailyPosts: 1, minPostHours: 3 });
  const { publishingDay } = await import('../../src/lib/social/queue');
  if (publishingDay(reserve) === publishingDay(reserve + 3 * 3600000))
    expect((await runPublishing(env)).sent).toBe(0);
  await saveSettings(env.DB, { ...(await getSettings(env.DB)), maxDailyPosts: 3 });
  await runPublishing(env);
  const scheduled: any = await db
    .prepare('SELECT scheduled_for,state FROM social_publishing_jobs WHERE draft_id=?')
    .bind(nextDraft.id)
    .first();
  expect(scheduled.state).toBe('demo-queued');
  expect(scheduled.scheduled_for).toBeGreaterThanOrEqual(reserve + 3 * 3600000);
  db.close();
});
it('withdraws a queued offer that becomes unavailable before delivery', async () => {
  const { db, env } = await approved();
  await runPublishing(env);
  await db.prepare('UPDATE product_listings SET available=0').run();
  await runPublishing(env);
  expect((await db.prepare('SELECT state FROM social_publishing_jobs').first<any>()).state).toBe(
    'cancelled',
  );
  db.close();
});
