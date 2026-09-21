-- Run this once in the D1 console if your database already exists.
-- (A brand-new database gets all of this from schema.sql instead.)

ALTER TABLE offers ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE offers ADD COLUMN external_id TEXT;

CREATE TABLE IF NOT EXISTS ebay_connection (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),
  environment               TEXT NOT NULL,
  refresh_token_enc         TEXT NOT NULL,
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
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  last_seen_at         TEXT,
  synced_at            TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_source_external_id ON offers (source, external_id);
CREATE INDEX IF NOT EXISTS idx_ebay_listings_watch_id ON ebay_listings (watch_id);
