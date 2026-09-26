# Watch Tracker

Track the watches you own, are selling, used to own, and want. One Cloudflare Worker serves the web app and its API. Data lives in D1 (SQL) and photos live in R2.

## Names to use

| Thing | Name | Notes |
| --- | --- | --- |
| Git repo | `watch-tracker` | |
| Worker | `watch-tracker` | Must match `name` in `wrangler.toml` |
| D1 database | `watch-tracker-db` | One database per app, so tables need no prefix |
| R2 bucket | `watch-tracker-images` | Lowercase letters, numbers, hyphens only. Cannot be renamed later |
| D1 binding | `DB` | Set in `wrangler.toml`, used in `src/worker.js` |
| R2 binding | `IMAGES` | Set in `wrangler.toml`, used in `src/worker.js` |

Keep the R2 bucket private. Do not turn on a public bucket URL. The Worker reads photos through the `IMAGES` binding and serves them at `/api/photos/<id>`.

## Table naming conventions

- Tables: snake_case, plural (`watches`, `watch_photos`, `service_records`, `offers`)
- Primary key: `id`. Foreign key: `<parent>_id` (for example `watch_id`)
- Money: whole cents in `*_cents` columns (USD)
- Dates: `YYYY-MM-DD` text in `*_date` or `*_on` columns. Timestamps: UTC text in `*_at`
- Indexes: `idx_<table>_<column>`
- R2 object keys: `watches/<watch id>/<random id>.<ext>`

## Setup (browser only)

1. **Create the D1 database** named `watch-tracker-db` in the Cloudflare dashboard. Copy its **Database ID** (a UUID) from the database overview page.
2. **Create the tables.** Open the database's Console, paste the contents of `schema.sql`, and run it. If the console rejects the full paste, run one `CREATE` statement at a time, starting with `watches`.
3. **Create the R2 bucket** named `watch-tracker-images`. Cloudflare may ask you to add a payment method to enable R2. The free tier includes 10 GB.
4. **Create the GitHub repo** `watch-tracker` and upload everything in this folder (keep the `src` and `public` folders as they are).
5. **Edit `wrangler.toml` in GitHub** (pencil icon). Replace `PASTE-YOUR-D1-DATABASE-ID-HERE` with your Database ID and commit.
6. **Deploy from the dashboard** with the same "Import a repository" flow as your other Workers. Name the Worker `watch-tracker`, leave the build command empty, and use the default deploy command (`npx wrangler deploy`).
7. Open the `workers.dev` URL Cloudflare gives you.

Every later push to the repo redeploys the app. If you change the database or bucket, edit `wrangler.toml`. Bindings in `wrangler.toml` replace any set by hand in the dashboard.

## eBay (optional): views and offers on the For sale page

Read-only. The app can pull your active eBay listings, their views and your Best Offers, and show them next to your own numbers. It never changes anything on eBay and never stores buyer names.

1. **Database:** if your database already exists, run `migrations/2026-09-ebay.sql` once in the D1 console. (A new database gets this from `schema.sql`.)
2. **eBay developer account:** sign in at developer.ebay.com with your seller account and create a **Production** keyset. eBay asks about *Marketplace Account Deletion* before it turns the keyset on. This app stores no buyer data, so request the exemption.
3. **Redirect URL (RuName):** in your eBay developer account, create a sign-in redirect URL for the keyset. Set its accepted URL to `https://YOUR-WORKER-ADDRESS/api/ebay/callback`, and use your app's address for the declined and privacy URLs. Copy the RuName eBay gives you into `EBAY_RU_NAME` in `wrangler.toml`.
4. **Secrets:** on the Worker in Cloudflare, add three Secrets: `EBAY_CLIENT_ID` (App ID), `EBAY_CLIENT_SECRET` (Cert ID) and `EBAY_TOKEN_KEY` (any long random string, 32 or more characters, which encrypts the saved eBay sign-in). Keep the key somewhere safe; if you lose it, just reconnect.
5. **Deploy**, open **For sale**, and choose **Connect eBay**. Approve access on eBay. The first sync runs by itself and then repeats every hour.
6. On a for-sale watch, choose **Link eBay listing**. Its views, watchers and offers then show on the watch and on the For sale page.

### Click-through rate (CTR)

The app keeps eBay's traffic numbers for each listing, one row per day, in the `ebay_listing_traffic` table. CTR is **search-results views ÷ search-results impressions**, so both numbers come from eBay search. Totals are summed over the period before dividing; daily percentages are never averaged. eBay's own `CLICK_THROUGH_RATE` is stored next to it for comparison.

- **Existing database:** run `migrations/2026-09-ebay-ctr.sql` once in the D1 console **before** deploying this version.
- The first sync after a listing appears loads up to 90 days of its history. After that, every traffic refresh (every 6 hours) re-pulls the last 3 days, because eBay revises recent days.
- History stays with the watch after it sells, so Past watches keep their CTR chart. Relisting the same watch adds to its history. Unlinking a listing by hand removes that listing's history from the watch.
- The For sale page shows 30-day CTR per watch and overall. A watch's page shows the chart (30 days, 90 days or all) and a table of daily numbers.

The permissions requested are read-only: the basic eBay scope, `sell.inventory.readonly` and `sell.analytics.readonly`. If a sync reports a permissions problem, the message on the For sale page is eBay's own wording.

## Protect it

The Worker has no login of its own, and the `workers.dev` address is public. Put Cloudflare Access in front of the Worker so only your email can open it.

## Optional: run locally

```
npm install
npx wrangler d1 execute watch-tracker-db --local --file=schema.sql
npx wrangler dev
```

## Layout

```
wrangler.toml     Worker, D1 and R2 configuration (edit the database_id)
schema.sql        Tables and indexes
src/worker.js     JSON API (D1 and R2)
src/ebay.js       eBay connection and sync
migrations/       One-off SQL for existing databases
public/           The web app (index.html, styles.css, app.js)
```
