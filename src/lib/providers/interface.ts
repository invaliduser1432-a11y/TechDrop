import type { Listing } from '../types';
export interface ProductProvider {
  id: string;
  minIntervalMs: number;
  refresh(listing: Listing): Promise<Listing>;
}
export class ProviderError extends Error {
  constructor(
    public code: 'rate-limit' | 'auth' | 'temporary' | 'invalid',
    public retryAfter = 60000,
  ) {
    super(
      `Provider ${code}; ${code === 'auth' ? 'check server credentials' : 'retry after the provider cooldown'}`,
    );
  }
}
export const identity = (
  l: Pick<Listing, 'externalId' | 'brand' | 'model' | 'variant' | 'condition' | 'currency'>,
) => [l.externalId, l.brand, l.model, l.variant, l.condition, l.currency].join('|');
