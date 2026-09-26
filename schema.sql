-- Watch Tracker: D1 schema
-- Database name:  watch-tracker-db
--
-- Naming conventions used throughout:
--   * tables:      snake_case, plural nouns (watches, watch_photos)
--   * primary key: id (INTEGER, auto-increment)
--   * foreign key: <singular_parent>_id (watch_id)
--   * money:       whole cents in INTEGER columns ending in _cents (USD)
--   * dates:       TEXT as YYYY-MM-DD in columns ending in _date or _on
--   * timestamps:  TEXT (UTC) in columns ending in _at
--   * flags:       INTEGER 0/1 named has_* or is_*
--   * indexes:     idx_<table>_<column>
--
-- Safe to run more than once (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS watches (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Where the watch is in its life: wishlist -> owned -> for_sale -> sold
  status                TEXT NOT NULL DEFAULT 'owned'
                          CHECK (status IN ('wishlist', 'owned', 'for_sale', 'sold')),

  -- Identity
  brand                 TEXT NOT NULL,
  model                 TEXT NOT NULL,
  reference_number      TEXT,
  serial_number         TEXT,

  -- Details
  case_size_mm          REAL,
  movement              TEXT,
  water_resistance_m    INTEGER,
  has_box_papers        INTEGER NOT NULL DEFAULT 0 CHECK (has_box_papers IN (0, 1)),
  condition             TEXT,
  notes                 TEXT,

  -- Purchase (owned, for_sale, sold)
  purchase_date         TEXT,
  purchase_price_cents  INTEGER,
  purchased_from        TEXT,

  -- Value
  est_value_cents       INTEGER,
  est_value_updated_on  TEXT,

  -- Listing (for_sale)
  asking_price_cents    INTEGER,
  listing_platform      TEXT,
  listed_date           TEXT,
  listing_status        TEXT
                          CHECK (listing_status IS NULL
                                 OR listing_status IN ('listed', 'offer_received', 'sale_pending')),

  -- Sale (sold)
  outcome               TEXT
                          CHECK (outcome IS NULL
                                 OR outcome IN ('sold', 'traded', 'gifted', 'other')),
  sale_price_cents      INTEGER,
  sale_date             TEXT,
  sold_via              TEXT,
  traded_for            TEXT,

  -- Wishlist
  priority              TEXT
                          CHECK (priority IS NULL
                                 OR priority IN ('high', 'medium', 'low')),
  target_price_cents    INTEGER,
  market_price_cents    INTEGER,
  source_url            TEXT,

  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watch_photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id      INTEGER NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL UNIQUE,      -- object key in the R2 bucket
  content_type  TEXT NOT NULL,
  byte_size     INTEGER,
  sort_order    INTEGER NOT NULL DEFAULT 0, -- lowest value = main photo
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id      INTEGER NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  serviced_on   TEXT NOT NULL,
  service_type  TEXT,
  provider      TEXT,
  cost_cents    INTEGER,
  next_due_on   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS offers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id      INTEGER NOT NULL REFERENCES watches (id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL,
  offered_by    TEXT,
  offered_on    TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'accepted', 'declined', 'expired')),
  source        TEXT NOT NULL DEFAULT 'manual',   -- 'manual' or 'ebay'
  external_id   TEXT,                             -- eBay Best Offer ID for synced offers
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ebay_connection (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),   -- one connected eBay account
  environment               TEXT NOT NULL,
  refresh_token_enc         TEXT NOT NULL,                        -- encrypted, never stored in plain text
  refresh_token_expires_at  TEXT,
  scopes                    TEXT,
  connected_at              TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_at              TEXT,
  last_traffic_sync_at      TEXT,
  last_sync_ok              INTEGER,
  last_sync_message         TEXT
);

CREATE TABLE IF NOT EXISTS ebay_listings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id              TEXT NOT NULL UNIQUE,
  watch_id             INTEGER REFERENCES watches (id) ON DELETE SET NULL,
  title                TEXT NOT NULL,
  listing_url          TEXT,
  listing_type         TEXT,
  price_cents          INTEGER,
  currency             TEXT,
  quantity             INTEGER,
  quantity_sold        INTEGER,
  watch_count          INTEGER,
  best_offer_enabled   INTEGER NOT NULL DEFAULT 0,
  best_offer_count     INTEGER,
  start_time           TEXT,
  end_time             TEXT,
  views_7d             INTEGER,
  views_30d            INTEGER,
  impressions_30d      INTEGER,
  traffic_backfilled_at TEXT,                            -- when daily traffic history was first loaded
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  last_seen_at         TEXT,
  synced_at            TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per eBay listing per day (eBay's reporting day). Kept after a watch sells,
-- so click-through history stays with the watch in Past.
-- CTR in the app = search_views / search_impressions.
CREATE TABLE IF NOT EXISTS ebay_listing_traffic (
  item_id              TEXT NOT NULL,
  report_date          TEXT NOT NULL,                        -- YYYY-MM-DD
  watch_id             INTEGER REFERENCES watches (id) ON DELETE SET NULL,
  impressions          INTEGER,                              -- LISTING_IMPRESSION_TOTAL
  views                INTEGER,                              -- LISTING_VIEWS_TOTAL
  search_impressions   INTEGER,                              -- LISTING_IMPRESSION_SEARCH_RESULTS_PAGE
  search_views         INTEGER,                              -- LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE
  ebay_ctr             REAL,                                 -- eBay's CLICK_THROUGH_RATE, as a fraction (0.012 = 1.2%)
  synced_at            TEXT,
  PRIMARY KEY (item_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_watches_status          ON watches (status);
CREATE INDEX IF NOT EXISTS idx_watch_photos_watch_id   ON watch_photos (watch_id);
CREATE INDEX IF NOT EXISTS idx_service_records_watch_id ON service_records (watch_id);
CREATE INDEX IF NOT EXISTS idx_offers_watch_id         ON offers (watch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_source_external_id ON offers (source, external_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listings_watch_id  ON ebay_listings (watch_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listing_traffic_watch_id ON ebay_listing_traffic (watch_id, report_date);
