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
public/           The web app (index.html, styles.css, app.js)
```
