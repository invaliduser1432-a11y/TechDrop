export function safeExternalUrl(input: string, hosts: string[]) {
  const url = new URL(input);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !hosts.includes(url.hostname.toLowerCase())
  )
    throw new Error('URL must use HTTPS on an approved retailer host');
  return url.href;
}
export function purchaseUrl(
  original: string,
  affiliate: string | null,
  ordinaryHosts: string[],
  affiliateHosts: string[],
) {
  return affiliate
    ? safeExternalUrl(affiliate, affiliateHosts)
    : safeExternalUrl(original, ordinaryHosts);
}
export interface AffiliateAdapter {
  link(original: string, authorizedUrl?: string | null): string;
}
export class RetailerAffiliate implements AffiliateAdapter {
  constructor(
    private ordinaryHosts: string[],
    private affiliateHosts: string[],
  ) {}
  link(original: string, authorizedUrl?: string | null) {
    return purchaseUrl(original, authorizedUrl ?? null, this.ordinaryHosts, this.affiliateHosts);
  }
}
