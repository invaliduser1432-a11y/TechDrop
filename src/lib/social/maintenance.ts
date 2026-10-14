import type { Env, DealView } from '../types';
import type { Settings } from '../config';
import { dealSelect, getListing, observations, logError } from '../db/repository';
import { scoreDeal } from '../price/scoring';
import { BufferClient, BufferError } from './buffer';
// Called under the publishing lock; bounded polling keeps transport and D1 usage small.
export async function maintainScheduledPosts(
  env: Env,
  settings: Settings,
  client: BufferClient | null,
) {
  const jobs = await env.DB.prepare(
    "SELECT j.*,dr.deal_id FROM social_publishing_jobs j JOIN social_post_drafts dr ON dr.id=j.draft_id WHERE j.state IN ('queued','demo-queued') ORDER BY j.scheduled_for LIMIT 3",
  ).all<any>();
  for (const job of jobs.results) {
    if (client) {
      const post = await client.status(job.buffer_post_id, settings.organizationId);
      if (post.status === 'sent' || post.status === 'error' || post.status === 'draft') {
        await env.DB.prepare('UPDATE social_publishing_jobs SET state=? WHERE id=?')
          .bind(
            post.status === 'sent' ? 'sent' : post.status === 'draft' ? 'remote-draft' : 'failed',
            job.id,
          )
          .run();
        continue;
      }
      if (post.status === 'sending') continue; // Already being delivered; do not mutate an in-flight post.
    }
    const deal = await env.DB.prepare(`${dealSelect} WHERE d.id=?`)
      .bind(job.deal_id)
      .first<DealView>();
    const listing = deal ? await getListing(env.DB, deal.listing_id) : null;
    const score = listing
      ? scoreDeal(listing, await observations(env.DB, listing.id), settings)
      : null;
    if (
      deal?.status === 'active' &&
      score?.qualified &&
      score.current === deal.current_cents &&
      score.baseline === deal.baseline_cents &&
      score.score >= settings.socialMinScore
    )
      continue;
    if (client) {
      await env.DB.prepare(
        "UPDATE social_publishing_jobs SET state='submitting',lease_until=? WHERE id=?",
      )
        .bind(Date.now() + 60000, job.id)
        .run();
      try {
        await client.withdraw(job.buffer_post_id);
      } catch (error) {
        const e = error instanceof BufferError ? error : new BufferError('uncertain');
        await env.DB.prepare('UPDATE social_publishing_jobs SET state=?,error=? WHERE id=?')
          .bind(e.kind === 'uncertain' ? 'uncertain' : 'queued', e.message, job.id)
          .run();
        await logError(env.DB, 'buffer', e.message);
        throw e;
      }
    }
    await env.DB.prepare(
      "UPDATE social_publishing_jobs SET state='cancelled',error='Scheduled offer expired or no longer qualifies' WHERE id=?",
    )
      .bind(job.id)
      .run();
  }
}
