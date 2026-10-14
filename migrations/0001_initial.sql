PRAGMA foreign_keys = ON;
CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)));
CREATE TABLE retailers (id TEXT PRIMARY KEY, name TEXT NOT NULL, allowed_hosts TEXT NOT NULL DEFAULT '[]', affiliate_hosts TEXT NOT NULL DEFAULT '[]');
CREATE TABLE data_providers (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, min_interval_seconds INTEGER NOT NULL DEFAULT 2, paused_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL, model TEXT NOT NULL, variant TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), specs TEXT NOT NULL DEFAULT '{}', UNIQUE(brand,model,variant));
CREATE TABLE product_listings (
 id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), external_id TEXT NOT NULL, provider_id TEXT NOT NULL REFERENCES data_providers(id), retailer_id TEXT NOT NULL REFERENCES retailers(id),
 condition TEXT NOT NULL CHECK(condition IN ('new','used','refurbished')), currency TEXT NOT NULL CHECK(currency='USD'), price_cents INTEGER NOT NULL CHECK(price_cents>=0), shipping_cents INTEGER CHECK(shipping_cents>=0),
 original_url TEXT NOT NULL, affiliate_url TEXT, image_url TEXT, image_permitted INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL, demo INTEGER NOT NULL DEFAULT 0,
 checked_at INTEGER NOT NULL, next_check_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0, seller_confidence REAL, identity_key TEXT NOT NULL, UNIQUE(provider_id,external_id)
);
CREATE TABLE price_observations (id INTEGER PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES product_listings(id), price_cents INTEGER NOT NULL, shipping_cents INTEGER, currency TEXT NOT NULL, observed_at INTEGER NOT NULL, source TEXT NOT NULL, identity_key TEXT NOT NULL, UNIQUE(listing_id,observed_at));
CREATE INDEX observation_history ON price_observations(listing_id, observed_at DESC);
CREATE INDEX eligible_listings ON product_listings(next_check_at,provider_id);
CREATE TABLE deals (id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES product_listings(id), slug TEXT NOT NULL UNIQUE, baseline_cents INTEGER NOT NULL, current_cents INTEGER NOT NULL, savings_cents INTEGER NOT NULL, discount REAL NOT NULL, score INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('review','active','rejected','expired')), featured INTEGER NOT NULL DEFAULT 0, detected_at INTEGER NOT NULL, published_at INTEGER, fingerprint TEXT NOT NULL UNIQUE);
CREATE INDEX public_deals ON deals(status,score DESC,detected_at DESC);
CREATE TABLE deal_scores (deal_id TEXT PRIMARY KEY REFERENCES deals(id), components TEXT NOT NULL, reasons TEXT NOT NULL, scored_at INTEGER NOT NULL);
CREATE TABLE social_post_drafts (id TEXT PRIMARY KEY, deal_id TEXT NOT NULL UNIQUE REFERENCES deals(id), text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', approved_at INTEGER);
CREATE TABLE social_publishing_jobs (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL UNIQUE REFERENCES social_post_drafts(id), idempotency_key TEXT NOT NULL UNIQUE, channel_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', buffer_post_id TEXT UNIQUE, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, submitted_at INTEGER, scheduled_for INTEGER, error TEXT);
CREATE INDEX publishing_due ON social_publishing_jobs(state,next_attempt_at);
CREATE TABLE affiliate_click_events (id TEXT PRIMARY KEY, deal_id TEXT NOT NULL REFERENCES deals(id), retailer TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX click_retention ON affiliate_click_events(created_at);
CREATE TABLE verified_revenue (id TEXT PRIMARY KEY, retailer TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL CHECK(currency='USD'), verified_at INTEGER NOT NULL, reference TEXT NOT NULL);
CREATE TABLE application_settings (id TEXT PRIMARY KEY CHECK(id='main'), value TEXT NOT NULL);
CREATE TABLE scheduled_job_runs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, checked INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'running', lease_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE error_logs (id TEXT PRIMARY KEY, scope TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE administrator_audit_events (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE rate_limit_buckets (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE distributed_locks (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
INSERT INTO data_providers(id,enabled) VALUES ('mock',1),('ebay',0),('feed',0);
INSERT INTO retailers(id,name,allowed_hosts,affiliate_hosts) VALUES ('demo','Demo retailer','["example.com"]','[]'),('ebay','eBay','["ebay.com","www.ebay.com"]','["ebay.com","www.ebay.com","rover.ebay.com"]');
