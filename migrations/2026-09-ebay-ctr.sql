-- Click-through rate history. Run this once in the D1 console
-- (after migrations/2026-09-ebay.sql, which you have already run).
-- A brand-new database gets all of this from schema.sql instead.

ALTER TABLE ebay_listings ADD COLUMN traffic_backfilled_at TEXT;

CREATE TABLE IF NOT EXISTS ebay_listing_traffic (
  item_id              TEXT NOT NULL,
  report_date          TEXT NOT NULL,
  watch_id             INTEGER REFERENCES watches (id) ON DELETE SET NULL,
  impressions          INTEGER,
  views                INTEGER,
  search_impressions   INTEGER,
  search_views         INTEGER,
  ebay_ctr             REAL,
  synced_at            TEXT,
  PRIMARY KEY (item_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_ebay_listing_traffic_watch_id ON ebay_listing_traffic (watch_id, report_date);
