-- Retailer API content is a temporary display cache, never price history.
INSERT OR IGNORE INTO data_providers(id,enabled,min_interval_seconds) VALUES ('amazon',0,2),('bestbuy',0,2);
INSERT OR IGNORE INTO retailers(id,name,allowed_hosts,affiliate_hosts) VALUES
 ('amazon','Amazon','["www.amazon.com","amazon.com"]','["www.amazon.com","amazon.com"]'),
 ('bestbuy','Best Buy','["www.bestbuy.com","bestbuy.com"]','[]');
CREATE TABLE retailer_targets (
 id TEXT PRIMARY KEY,
 provider_id TEXT NOT NULL REFERENCES data_providers(id) CHECK(provider_id IN ('amazon','bestbuy')),
 mode TEXT NOT NULL CHECK(mode IN ('search','items')),
 query TEXT NOT NULL,
 category_id TEXT NOT NULL REFERENCES categories(id),
 auto_publish INTEGER NOT NULL DEFAULT 0 CHECK(auto_publish IN (0,1)),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 next_check_at INTEGER NOT NULL DEFAULT 0,
 failures INTEGER NOT NULL DEFAULT 0,
 last_checked_at INTEGER,
 last_error TEXT,
 UNIQUE(provider_id,mode,query)
);
CREATE TABLE retailer_offer_cache (
 id TEXT PRIMARY KEY,
 target_id TEXT NOT NULL REFERENCES retailer_targets(id) ON DELETE CASCADE,
 provider_id TEXT NOT NULL REFERENCES data_providers(id),
 payload TEXT NOT NULL,
 approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1)),
 fetched_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>fetched_at AND expires_at<=fetched_at+3600000)
);
CREATE INDEX retailer_offer_expiry ON retailer_offer_cache(expires_at);
CREATE INDEX retailer_target_due ON retailer_targets(enabled,next_check_at);
