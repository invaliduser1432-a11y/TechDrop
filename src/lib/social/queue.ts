import type { Env, DealView } from '../types';
import { getSettings, saveSettings } from '../config';
import { dealSelect, lock, unlock, logError, getListing, observations } from '../db/repository';
import { scoreDeal } from '../price/scoring';
import { BufferClient, BufferError } from './buffer';
import { generatePost } from './posts';
import { maintainScheduledPosts } from './maintenance';
export async function createLocalDraft(env: Env, dealId: string) {
  const deal = await env.DB.prepare(`${dealSelect} WHERE d.id=? AND l.demo=?`)
    .bind(dealId, env.APP_MODE === 'demo' ? 1 : 0)
    .first<DealView>();
  if (!deal) throw new Error('Deal not found');
  const settings = await getSettings(env.DB);
  const text = generatePost(deal, env.SITE_URL, settings.freshnessMinutes),
    id = crypto.randomUUID();
  await env.DB.prepare('INSERT OR IGNORE INTO social_post_drafts(id,deal_id,text) VALUES (?,?,?)')
    .bind(id, deal.id, text)
    .run();
  return env.DB.prepare('SELECT * FROM social_post_drafts WHERE deal_id=?').bind(deal.id).first();
}
export async function approveDraft(env: Env, id: string) {
  const s = await getSettings(env.DB);
  if (s.postingMode === 'disabled')
    throw new Error('Select manual approval mode before approving a draft');
  await env.DB.prepare(
    "UPDATE social_post_drafts SET status='approved',approved_at=? WHERE id=? AND status='draft'",
  )
    .bind(Date.now(), id)
    .run();
}
export function publishingAllowed(env: Env, s: Awaited<ReturnType<typeof getSettings>>) {
  return (
    env.APP_MODE === 'production' &&
    env.LIVE_PUBLISHING_ALLOWED === 'true' &&
    !!env.BUFFER_TOKEN &&
    s.accountEligible &&
    !!s.channelId &&
    !!s.organizationId &&
    s.postingMode !== 'disabled' &&
    s.publishingPausedUntil <= Date.now()
  );
}
export const publishingDay = (at: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
export async function runPublishing(env: Env, client?: BufferClient) {
  const s = await getSettings(env.DB);
  if (s.postingMode === 'disabled') return { sent: 0, disabled: true };
  const simulated = env.APP_MODE === 'demo';
  if (!simulated && !publishingAllowed(env, s)) return { sent: 0, blocked: true };
  const owner = crypto.randomUUID();
  if (!(await lock(env.DB, 'publishing', owner, 300000))) return { sent: 0, busy: true };
  let sent = 0;
  try {
    await env.DB.prepare(
      "UPDATE social_publishing_jobs SET state='uncertain',error='Interrupted request; reconcile in Buffer' WHERE state='submitting' AND lease_until<?",
    )
      .bind(Date.now())
      .run();
    if (s.postingMode === 'automatic') {
      const deals = await env.DB.prepare(
        `${dealSelect} WHERE d.status='active' AND d.score>=? AND l.demo=? AND l.available=1 LIMIT 20`,
      )
        .bind(s.socialMinScore, +simulated)
        .all<DealView>();
      for (const deal of deals.results) {
        try {
          await createLocalDraft(env, deal.id);
        } catch {
          continue;
        }
      }
      await env.DB.prepare(
        "UPDATE social_post_drafts SET status='approved',approved_at=? WHERE status='draft' AND deal_id IN (SELECT id FROM deals WHERE status='active' AND score>=?)",
      )
        .bind(Date.now(), s.socialMinScore)
        .run();
    }
    const drafts = await env.DB.prepare(
      "SELECT id FROM social_post_drafts WHERE status='approved' LIMIT 20",
    ).all<{ id: string }>();
    for (const d of drafts.results)
      await env.DB.prepare(
        'INSERT OR IGNORE INTO social_publishing_jobs(id,draft_id,idempotency_key,channel_id) VALUES (?,?,?,?)',
      )
        .bind(crypto.randomUUID(), d.id, `draft:${d.id}`, simulated ? 'demo-x' : s.channelId)
        .run();
    const jobs = await env.DB.prepare(
      "SELECT j.*,d.deal_id,d.text FROM social_publishing_jobs j JOIN social_post_drafts d ON d.id=j.draft_id WHERE j.state IN ('pending','remote-draft','retry') AND j.next_attempt_at<=? ORDER BY j.rowid LIMIT 3",
    )
      .bind(Date.now())
      .all<any>();
    const remote = simulated ? null : (client ?? new BufferClient(env.BUFFER_TOKEN!));
    await maintainScheduledPosts(env, s, remote);
    if (remote && jobs.results.length) await remote.ensureXChannel(s.organizationId, s.channelId);
    for (const job of jobs.results) {
      const deal = await env.DB.prepare(`${dealSelect} WHERE d.id=?`)
        .bind(job.deal_id)
        .first<DealView>();
      const listing = deal ? await getListing(env.DB, deal.listing_id) : null;
      const scored = listing ? scoreDeal(listing, await observations(env.DB, listing.id), s) : null;
      if (
        !deal ||
        deal.status !== 'active' ||
        !scored?.qualified ||
        deal.demo !== +simulated ||
        deal.current_cents !== scored.current ||
        deal.baseline_cents !== scored.baseline ||
        scored.score < s.socialMinScore
      ) {
        await env.DB.prepare(
          "UPDATE social_publishing_jobs SET state='cancelled',error='Deal no longer qualifies' WHERE id=?",
        )
          .bind(job.id)
          .run();
        continue;
      }
      if (!simulated && job.channel_id !== s.channelId) {
        await env.DB.prepare(
          "UPDATE social_publishing_jobs SET state='cancelled',error='Channel changed; review draft' WHERE id=?",
        )
          .bind(job.id)
          .run();
        continue;
      }
      const similar = await env.DB.prepare(
        `SELECT j.id FROM social_publishing_jobs j JOIN social_post_drafts dr ON dr.id=j.draft_id JOIN deals de ON de.id=dr.deal_id JOIN product_listings li ON li.id=de.listing_id JOIN products p ON p.id=li.product_id WHERE p.brand=? AND p.model=? AND p.variant=? AND li.condition=? AND j.id<>? AND j.state IN ('queued','sent','demo-queued','submitting','uncertain') AND j.scheduled_for>? LIMIT 1`,
      )
        .bind(
          listing!.brand,
          listing!.model,
          listing!.variant,
          listing!.condition,
          job.id,
          Date.now() - s.duplicateHours * 3600000,
        )
        .first();
      if (similar) {
        await env.DB.prepare(
          "UPDATE social_publishing_jobs SET state='cancelled',error='A substantially similar product was posted recently' WHERE id=?",
        )
          .bind(job.id)
          .run();
        continue;
      }
      const freshSettings = await getSettings(env.DB);
      if (
        freshSettings.postingMode === 'disabled' ||
        freshSettings.publishingPausedUntil > Date.now()
      )
        break;
      const reservations = await env.DB.prepare(
        "SELECT scheduled_for FROM social_publishing_jobs WHERE state IN ('queued','sent','demo-queued','submitting','uncertain') AND scheduled_for IS NOT NULL ORDER BY scheduled_for DESC LIMIT 100",
      ).all<{ scheduled_for: number }>();
      const due = Math.max(
        Date.now() + 300000,
        (reservations.results[0]?.scheduled_for ?? 0) + s.minPostHours * 3600000,
      );
      if (
        reservations.results.filter((j) => publishingDay(j.scheduled_for) === publishingDay(due))
          .length >= s.maxDailyPosts
      )
        break;
      const text = generatePost(deal, env.SITE_URL, s.freshnessMinutes);
      // Claim is durable BEFORE an outbound mutation. Ambiguous outcomes never auto-resend.
      await env.DB.prepare(
        "UPDATE social_publishing_jobs SET state='submitting',attempts=attempts+1,lease_until=?,scheduled_for=? WHERE id=?",
      )
        .bind(Date.now() + 60000, due, job.id)
        .run();
      try {
        let bufferId = job.buffer_post_id;
        if (remote && !bufferId) {
          const draft = await remote.createDraft(s.channelId, text);
          bufferId = draft.id;
          await env.DB.prepare(
            "UPDATE social_publishing_jobs SET buffer_post_id=?,state='remote-draft' WHERE id=?",
          )
            .bind(bufferId, job.id)
            .run();
        }
        const latest = await getSettings(env.DB);
        if (latest.postingMode === 'disabled') {
          await env.DB.prepare("UPDATE social_publishing_jobs SET state='cancelled' WHERE id=?")
            .bind(job.id)
            .run();
          break;
        }
        if (remote) {
          // Editing a persisted draft does not create a second post.
          await env.DB.prepare("UPDATE social_publishing_jobs SET state='submitting' WHERE id=?")
            .bind(job.id)
            .run();
          await remote.enqueue(bufferId, new Date(due).toISOString());
        }
        await env.DB.batch([
          env.DB.prepare(
            'UPDATE social_publishing_jobs SET state=?,buffer_post_id=?,submitted_at=?,error=NULL WHERE id=?',
          ).bind(
            simulated ? 'demo-queued' : 'queued',
            bufferId ?? `mock-${job.id}`,
            Date.now(),
            job.id,
          ),
          env.DB.prepare("UPDATE social_post_drafts SET status='submitted',text=? WHERE id=?").bind(
            text,
            job.draft_id,
          ),
        ]);
        sent++;
      } catch (error) {
        const e = error instanceof BufferError ? error : new BufferError('uncertain');
        const retry = e.kind === 'rate-limit';
        await env.DB.prepare(
          'UPDATE social_publishing_jobs SET state=?,next_attempt_at=?,error=? WHERE id=?',
        )
          .bind(
            retry ? 'retry' : e.kind === 'uncertain' ? 'uncertain' : 'failed',
            Date.now() + e.retryAfter * Math.min(16, 2 ** job.attempts),
            e.message,
            job.id,
          )
          .run();
        await logError(env.DB, 'buffer', e.message);
        if (e.kind === 'auth' || retry) {
          await saveSettings(env.DB, {
            ...(await getSettings(env.DB)),
            postingMode: e.kind === 'auth' ? 'disabled' : s.postingMode,
            publishingPausedUntil: Date.now() + e.retryAfter,
          });
          break;
        }
      }
    }
    return { sent, simulated };
  } catch (error) {
    const e = error instanceof BufferError ? error : new BufferError('uncertain');
    await logError(env.DB, 'buffer', e.message);
    if (e.kind === 'auth' || e.kind === 'rate-limit')
      await saveSettings(env.DB, {
        ...(await getSettings(env.DB)),
        postingMode: e.kind === 'auth' ? 'disabled' : s.postingMode,
        publishingPausedUntil: Date.now() + e.retryAfter,
      });
    return { sent, error: e.kind };
  } finally {
    await unlock(env.DB, 'publishing', owner);
  }
}
export async function reconcile(env: Env, id: string) {
  const s = await getSettings(env.DB);
  if (!publishingAllowed(env, s))
    throw new Error('Enable authorized manual mode to reconcile Buffer status');
  const job = await env.DB.prepare('SELECT * FROM social_publishing_jobs WHERE id=?')
    .bind(id)
    .first<any>();
  if (!job?.buffer_post_id)
    throw new Error('Remote ID unknown: inspect Buffer manually before resolving this job');
  const post = await new BufferClient(env.BUFFER_TOKEN!).status(
    job.buffer_post_id,
    s.organizationId,
  );
  const state =
    post.status === 'sent'
      ? 'sent'
      : post.status === 'scheduled' || post.status === 'sending'
        ? 'queued'
        : post.status === 'draft'
          ? 'remote-draft'
          : 'failed';
  await env.DB.prepare('UPDATE social_publishing_jobs SET state=?,error=NULL WHERE id=?')
    .bind(state, id)
    .run();
  return post;
}
