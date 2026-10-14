# Affiliate setup

Apply to the retailer's official program and obtain approval before using affiliate URLs. Follow its rules for website/social traffic, disclosures, images, link destinations, retention and permitted platforms. Verify account age, legal capacity and eligibility from current program terms; use truthful account information and a legitimate authorized account holder. No account is created or restriction bypassed here.

For eBay, follow the [eBay Partner Network](https://partnernetwork.ebay.com/) and the [Browse API getItem documentation](https://developer.ebay.com/api-docs/buy/browse/resources/item/methods/getItem). Provide your actual approved campaign ID as `EBAY_CAMPAIGN_ID`; the server adds the official `affiliateCampaignId` context. If eBay returns `itemAffiliateWebUrl`, it is validated and stored. No campaign ID means no generated affiliate claim; the ordinary `itemWebUrl` remains usable.

For other retailers, authorize exact hosts in `FEED_HOSTS`, add the retailer, then import its official affiliate URL or save an authorized URL in the tracked listing's admin row. Both ordinary and affiliate destinations must use HTTPS and an approved host with no embedded credentials or unusual port. No invented affiliate IDs or arbitrary redirect destinations are accepted.

Disclosures appear beside purchase links and in the footer, with a dedicated `/affiliate-disclosure` page. Generated social posts include #ad and point to the website's deal page; they do not publish a direct affiliate link. Check the program's social usage policy before turning on publishing.

Click tracking stores only deal, retailer, source and time. It is a best-effort event submitted separately from the direct outbound link; it never blocks the visitor's destination. Clicks are not commission confirmations. Enter independently verified statement amounts in admin to record revenue. USD cents are used; avoid treating estimates as verified commissions.
