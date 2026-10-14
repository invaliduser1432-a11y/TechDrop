import type { Listing } from '../types';
import type { ProductProvider } from './interface';
export class MockProvider implements ProductProvider {
  id = 'mock';
  minIntervalMs = 0;
  async refresh(listing: Listing): Promise<Listing> {
    if (!listing.demo) throw new Error('Mock provider refuses real listings');
    return { ...listing, checkedAt: Date.now() };
  }
}
