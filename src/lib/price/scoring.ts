import type { Listing, Observation } from '../types';
import type { Settings } from '../config';
const DAY = 86400000;
export function median(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2 : 0;
}
export function historyStats(listing: Listing, observations: Observation[], now = Date.now()) {
  const valid = observations
    .filter(
      (o) =>
        o.listingId === listing.id &&
        o.identityKey === listing.identityKey &&
        o.currency === listing.currency &&
        o.shipping !== null &&
        o.at <= now,
    )
    .sort((a, b) => a.at - b.at);
  const previous = valid.filter((o) => o.at < listing.checkedAt && o.at >= now - 30 * DAY);
  const totals = previous.map((o) => o.price + o.shipping!);
  const days = new Set(previous.map((o) => Math.floor(o.at / DAY))).size;
  const span = previous.length ? (previous.at(-1)!.at - previous[0].at) / DAY : 0;
  const gap = previous.reduce(
    (m, o, i) => (i ? Math.max(m, (o.at - previous[i - 1].at) / 3600000) : m),
    previous.length ? (listing.checkedAt - previous.at(-1)!.at) / 3600000 : 0,
  );
  const total = listing.price + (listing.shipping ?? 0);
  const change = (d: number) => {
    const o = valid.filter((o) => o.at <= now - d * DAY && o.at >= now - (d + 1) * DAY).at(-1);
    return o
      ? Math.round(((total - (o.price + o.shipping!)) / (o.price + o.shipping!)) * 1000) / 10
      : null;
  };
  const has30 =
    valid.length > 0 &&
    valid[0].at <= now - 30 * DAY &&
    new Set(valid.filter((o) => o.at >= now - 31 * DAY).map((o) => Math.floor(o.at / DAY))).size >=
      30 &&
    gap <= 48;
  return {
    observations: valid,
    baseline: Math.round(median(totals)),
    low: totals.length ? Math.min(...totals, total) : total,
    high: totals.length ? Math.max(...totals, total) : total,
    average: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : total,
    median: Math.round(median(totals)),
    days,
    span,
    gap,
    samples: previous.length,
    change7: change(7),
    change30: change(30),
    is30DayLow:
      has30 &&
      total <=
        Math.min(...valid.filter((o) => o.at >= now - 30 * DAY).map((o) => o.price + o.shipping!)),
  };
}
export function scoreDeal(
  listing: Listing,
  observations: Observation[],
  settings: Settings,
  lastPublished: number | null = null,
  now = Date.now(),
) {
  const history = historyStats(listing, observations, now),
    current = listing.price + (listing.shipping ?? 0);
  const savings = Math.max(0, history.baseline - current),
    discount = history.baseline > 0 ? (savings / history.baseline) * 100 : 0;
  const fresh =
    now - listing.checkedAt <= settings.freshnessMinutes * 60000 && listing.checkedAt <= now;
  const evidence =
    history.days >= settings.minHistorySamples &&
    history.span >= settings.minHistoryDays &&
    history.gap <= settings.maxHistoryGapHours;
  const duplicate =
    lastPublished !== null && now - lastPublished < settings.duplicateHours * 3600000;
  const reasons: string[] = [];
  if (!evidence) reasons.push('Insufficient continuous historical evidence');
  if (listing.shipping === null) reasons.push('Shipping cost is unknown');
  if (!listing.available) reasons.push('Listing is unavailable');
  if (!fresh) reasons.push('Price needs rechecking');
  if (discount < settings.minDiscount) reasons.push('Percentage savings below threshold');
  if (savings < settings.minSavings) reasons.push('Dollar savings below threshold');
  if (duplicate) reasons.push('Recently published listing');
  const components = {
    discount: Math.min(1, discount / 30),
    savings: Math.min(1, savings / 5000),
    history: evidence ? Math.min(1, history.days / 14) : 0,
    freshness: fresh ? 1 : 0,
    availability: listing.available ? 1 : 0,
    seller: listing.sellerConfidence ?? 0,
  };
  const weights = settings.scoreWeights,
    weightTotal = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (Object.entries(components).reduce(
          (sum, [k, v]) => sum + v * weights[k as keyof typeof weights],
          0,
        ) /
          weightTotal) *
          100 +
          (settings.categoryBoosts[listing.category] ?? 0),
      ),
    ),
  );
  if (score < settings.minScore) reasons.push('Score below threshold');
  return {
    qualified: reasons.length === 0,
    score,
    components,
    reasons,
    history,
    baseline: history.baseline,
    current,
    savings,
    discount: Math.round(discount * 10) / 10,
  };
}
