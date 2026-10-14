import type { DealView } from '../types';
import { money } from '../types';
export function generatePost(deal: DealView, siteUrl: string, freshnessMinutes = 60) {
  if (
    deal.status !== 'active' ||
    !deal.available ||
    Date.now() - deal.checked_at > freshnessMinutes * 60000 ||
    deal.current_cents !== deal.price_cents + (deal.shipping_cents ?? 0)
  )
    throw new Error('A current, approved deal is required');
  const url = new URL(`/deals/${deal.slug}`, siteUrl).href;
  const name = deal.name.replace(/[^\x20-\x7E]/g, '').slice(0, 95);
  const text = `${deal.demo ? 'DEMO • ' : ''}PRICE DROP: ${name}\n\nNow: ${money(deal.current_cents)}\nPreviously observed: ${money(deal.baseline_cents)}\nSavings: ${Math.floor(deal.discount)}% (${money(deal.savings_cents)})\n\n#ad\n${url}`;
  // URLs count as 23 on X. All generated non-URL text is ASCII, conservatively capped.
  if (text.replace(url, 'x'.repeat(23)).length > 280)
    throw new Error('Post exceeds X character limit');
  return text;
}
