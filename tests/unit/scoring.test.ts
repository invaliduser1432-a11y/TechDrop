import { describe, it, expect } from 'vitest';
import { fixture, history } from '../helpers/database';
import { scoreDeal, historyStats } from '../../src/lib/price/scoring';
import { defaults } from '../../src/lib/config';
describe('historical deal qualification', () => {
  it('detects $125 to $89 SSD drop from the same listing', () => {
    const l = fixture(),
      r = scoreDeal(l, history(l), defaults);
    expect(r.qualified).toBe(true);
    expect(r.savings).toBe(3600);
    expect(r.discount).toBe(28.8);
    expect(r.baseline).toBe(12500);
  });
  it('rejects a normal price fluctuation', () => {
    const l = fixture({ price: 12000 });
    expect(scoreDeal(l, history(l), defaults).qualified).toBe(false);
  });
  it('ignores crossed-out original prices absent from observations', () => {
    const l = { ...fixture({ price: 12000 }), originalPrice: 25000 };
    expect(scoreDeal(l, history(l), defaults).discount).toBe(4);
  });
  it('does not qualify insufficient or same-day dense history', () => {
    const l = fixture();
    expect(scoreDeal(l, history(l, 3), defaults).qualified).toBe(false);
    expect(
      scoreDeal(
        l,
        history(l).map((o, i) => ({ ...o, at: l.checkedAt - i * 1000 })),
        defaults,
      ).qualified,
    ).toBe(false);
  });
  it('requires known shipping, fresh prices and stock', () => {
    for (const override of [
      { shipping: null },
      { available: false },
      { checkedAt: Date.now() - 7200000 },
    ]) {
      const l = fixture(override);
      expect(scoreDeal(l, history(l), defaults).qualified).toBe(false);
    }
  });
  it('rejects history from another listing, variant, condition or currency', () => {
    const l = fixture();
    for (const override of [
      { listingId: 'other' },
      { identityKey: 'used-1tb' },
      { currency: 'EUR' },
    ])
      expect(
        scoreDeal(
          l,
          history(l).map((o) => ({ ...o, ...override })),
          defaults,
        ).qualified,
      ).toBe(false);
  });
  it('rejects sparse history and future observations', () => {
    const l = fixture();
    expect(
      scoreDeal(
        l,
        history(l).filter((_, i) => i % 4 === 0),
        defaults,
      ).qualified,
    ).toBe(false);
    expect(
      scoreDeal(
        l,
        history(l).map((o) => ({ ...o, at: Date.now() + 100000 })),
        defaults,
      ).qualified,
    ).toBe(false);
  });
  it('only declares a 30-day low after sufficient continuous history', () => {
    const l = fixture();
    expect(historyStats(l, history(l, 14)).is30DayLow).toBe(false);
    expect(historyStats(l, history(l, 35)).is30DayLow).toBe(true);
  });
  it('applies configurable thresholds and recent-publication cooldown', () => {
    const l = fixture();
    expect(scoreDeal(l, history(l), { ...defaults, minDiscount: 40 }).qualified).toBe(false);
    expect(scoreDeal(l, history(l), defaults, Date.now() - 1000).qualified).toBe(false);
  });
});

it('rejects an unobserved gap between old history and the current drop', () => {
  const l = fixture();
  const old = history(l, 35).filter((o) => o.at < l.checkedAt - 14 * 86400000);
  expect(scoreDeal(l, old, defaults).qualified).toBe(false);
});
