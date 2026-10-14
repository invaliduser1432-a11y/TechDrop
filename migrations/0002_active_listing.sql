-- One active publication per exact listing even under concurrent administrator requests.
CREATE UNIQUE INDEX one_active_deal_per_listing ON deals(listing_id) WHERE status='active';
