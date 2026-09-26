// eBay integration for the Watch Tracker (read-only).
//
// What it does
//   1. Connects your eBay seller account with eBay's "authorization code" sign-in
//      (you approve once; the Worker keeps an encrypted refresh token in D1).
//   2. Pulls your active listings (Trading API: GetMyeBaySelling), views and
//      impressions (Sell Analytics: traffic_report) and Best Offers (GetBestOffers).
//      Daily traffic is kept per listing so click-through rate can be charted over time.
//   3. Stores them in D1 so the For sale pages can show them next to your own numbers.
//
// It never writes anything to eBay and never stores buyer names.

export class EbayError extends Error {}

const DEFAULT_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
];
const TRADING_COMPAT_LEVEL = '1423';
const TRAFFIC_REFRESH_HOURS = 6;
const MIN_SYNC_GAP_SECONDS = 60;

/* ---------------------------------------------------------------- config */

export function isConfigured(env) {
  return !!(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET && env.EBAY_TOKEN_KEY && env.EBAY_RU_NAME && !/^PASTE-/i.test(env.EBAY_RU_NAME));
}

function config(env) {
  const production = (env.EBAY_ENV || 'production') !== 'sandbox';
  return {
    clientId: env.EBAY_CLIENT_ID,
    clientSecret: env.EBAY_CLIENT_SECRET,
    ruName: env.EBAY_RU_NAME,
    production,
    authBase: production ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com',
    apiBase: production ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com',
    siteId: env.EBAY_SITE_ID || '0',
    marketplace: env.EBAY_MARKETPLACE || 'EBAY_US',
    scopes: (env.EBAY_SCOPES ? env.EBAY_SCOPES.split(/[\s,]+/).filter(Boolean) : DEFAULT_SCOPES),
  };
}

/* ---------------------------------------------------------------- crypto */

const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function derive(env, label) {
  return crypto.subtle.digest('SHA-256', enc.encode(`${label}:${env.EBAY_TOKEN_KEY}`));
}

async function encrypt(env, plain) {
  const key = await crypto.subtle.importKey('raw', await derive(env, 'token-encryption'), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  return b64(new Uint8Array([...iv, ...ct]));
}

async function decrypt(env, sealed) {
  const bytes = unb64(sealed);
  const key = await crypto.subtle.importKey('raw', await derive(env, 'token-encryption'), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(plain);
}

async function sign(env, message) {
  const key = await crypto.subtle.importKey('raw', await derive(env, 'oauth-state'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/* ------------------------------------------------------------------- XML */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e.toLowerCase()];
});

// Small XML reader for eBay's responses. Elements with children become objects
// (repeated names become arrays); text-only elements become strings, or
// { _: text, $: attributes } when they carry attributes (for example currencyID).
export function parseXml(xml) {
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/[^\s>]+\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const local = (n) => n.replace(/^.*:/, '');
  const root = { name: '#root', attrs: null, children: [], text: '' };
  const stack = [root];
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2] !== undefined) {
      const attrs = {};
      for (const a of (m[3] || '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[local(a[1])] = decodeEntities(a[2] ?? a[3] ?? '');
      const el = { name: local(m[2]), attrs, children: [], text: '' };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[5] !== undefined) top.text += decodeEntities(m[5]);
    else if (m[0].startsWith('</') && stack.length > 1) stack.pop();
  }
  const build = (el) => {
    if (!el.children.length) {
      const t = el.text.trim();
      return el.attrs && Object.keys(el.attrs).length ? { _: t, $: el.attrs } : t;
    }
    const out = {};
    for (const c of el.children) {
      const v = build(c);
      if (c.name in out) out[c.name] = Array.isArray(out[c.name]) ? [...out[c.name], v] : [out[c.name], v];
      else out[c.name] = v;
    }
    return out;
  };
  return build(root);
}

const arr = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : [v]);
const txt = (n) => (n === undefined || n === null ? null : typeof n === 'string' ? n : n._ ?? null);
const attr = (n, name) => (n && typeof n === 'object' ? n.$?.[name] : undefined);
const toInt = (n) => { const t = txt(n); const v = t === null || t === '' ? NaN : parseInt(t, 10); return Number.isFinite(v) ? v : null; };
const toCents = (n) => { const t = txt(n); const v = t === null || t === '' ? NaN : parseFloat(t); return Number.isFinite(v) ? Math.round(v * 100) : null; };

/* ------------------------------------------------------------- OAuth flow */

function cookieValue(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export async function beginConnect(env) {
  if (!isConfigured(env)) {
    const q = new URLSearchParams({ ebay: 'error', msg: 'eBay is not set up yet. Add your eBay keys first (see the README).' });
    return new Response(null, { status: 302, headers: { location: `/?${q}#/for-sale`, 'cache-control': 'no-store' } });
  }
  const cfg = config(env);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const state = `${nonce}.${await sign(env, nonce)}`;
  const url = new URL(cfg.authBase + '/oauth2/authorize');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', cfg.ruName);
  url.searchParams.set('scope', cfg.scopes.join(' '));
  url.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
      'set-cookie': `ebay_oauth=${nonce}; Path=/api/ebay; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      'cache-control': 'no-store',
    },
  });
}

async function tokenRequest(cfg, params) {
  const res = await fetch(cfg.apiBase + '/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: 'Basic ' + btoa(`${cfg.clientId}:${cfg.clientSecret}`),
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new EbayError(`eBay sign-in failed: ${data.error_description || data.error || res.status}`);
  return data;
}

// Returns a redirect back to the app, with a short result flag in the query string.
export async function finishConnect(env, request) {
  const back = (flag, message) => {
    const q = new URLSearchParams({ ebay: flag });
    if (message) q.set('msg', message.slice(0, 200));
    return new Response(null, {
      status: 302,
      headers: { location: `/?${q}#/for-sale`, 'set-cookie': 'ebay_oauth=; Path=/api/ebay; Max-Age=0; HttpOnly; Secure; SameSite=Lax', 'cache-control': 'no-store' },
    });
  };
  try {
    if (!isConfigured(env)) throw new EbayError('eBay is not set up yet.');
    const url = new URL(request.url);
    if (url.searchParams.get('error')) throw new EbayError('eBay sign-in was cancelled or declined.');
    const code = url.searchParams.get('code');
    const [nonce, sig] = (url.searchParams.get('state') || '').split('.');
    if (!code || !nonce || !sig || sig !== (await sign(env, nonce)) || nonce !== cookieValue(request, 'ebay_oauth')) {
      throw new EbayError('The eBay sign-in could not be verified. Start again from the For sale page.');
    }
    const cfg = config(env);
    const tok = await tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.ruName });
    if (!tok.refresh_token) throw new EbayError('eBay did not return a refresh token.');
    const expires = tok.refresh_token_expires_in ? new Date(Date.now() + tok.refresh_token_expires_in * 1000).toISOString() : null;
    await env.DB.prepare(
      `INSERT INTO ebay_connection (id, environment, refresh_token_enc, refresh_token_expires_at, scopes, connected_at, last_sync_ok, last_sync_message)
       VALUES (1, ?, ?, ?, ?, datetime('now'), NULL, NULL)
       ON CONFLICT (id) DO UPDATE SET environment = excluded.environment, refresh_token_enc = excluded.refresh_token_enc,
         refresh_token_expires_at = excluded.refresh_token_expires_at, scopes = excluded.scopes, connected_at = datetime('now'),
         last_sync_ok = NULL, last_sync_message = NULL`
    ).bind(cfg.production ? 'production' : 'sandbox', await encrypt(env, tok.refresh_token), expires, cfg.scopes.join(' ')).run();
    return back('connected');
  } catch (err) {
    return back('error', err instanceof EbayError ? err.message : 'Something went wrong connecting to eBay.');
  }
}

async function accessToken(env, conn) {
  const cfg = config(env);
  const refresh = await decrypt(env, conn.refresh_token_enc);
  const tok = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refresh });
  return tok.access_token;
}

export async function disconnect(env) {
  await env.DB.prepare('DELETE FROM ebay_connection WHERE id = 1').run();
}

export async function status(env) {
  const configured = isConfigured(env);
  const conn = configured ? await env.DB.prepare('SELECT * FROM ebay_connection WHERE id = 1').first() : null;
  return {
    configured,
    connected: !!conn,
    environment: conn?.environment ?? null,
    connected_at: conn?.connected_at ?? null,
    last_sync_at: conn?.last_sync_at ?? null,
    last_sync_ok: conn ? conn.last_sync_ok : null,
    last_sync_message: conn?.last_sync_message ?? null,
    refresh_expires_at: conn?.refresh_token_expires_at ?? null,
  };
}

/* ------------------------------------------------------------ eBay calls */

async function trading(cfg, token, callName, innerXml) {
  const body = `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${innerXml}</${callName}Request>`;
  const res = await fetch(cfg.apiBase + '/ws/api.dll', {
    method: 'POST',
    headers: {
      'content-type': 'text/xml',
      'x-ebay-api-call-name': callName,
      'x-ebay-api-siteid': cfg.siteId,
      'x-ebay-api-compatibility-level': TRADING_COMPAT_LEVEL,
      'x-ebay-api-iaf-token': token,
    },
    body,
  });
  const xml = await res.text();
  let root;
  try { root = parseXml(xml); } catch { root = {}; }
  const resp = root[`${callName}Response`];
  if (!resp) throw new EbayError(`eBay ${callName}: unexpected response (HTTP ${res.status}).`);
  const ack = txt(resp.Ack);
  if (ack === 'Failure' || !res.ok) {
    const e = arr(resp.Errors)[0] || {};
    throw new EbayError(`eBay ${callName}: ${txt(e.LongMessage) || txt(e.ShortMessage) || 'request failed'}${txt(e.ErrorCode) ? ` (code ${txt(e.ErrorCode)})` : ''}`);
  }
  return resp;
}

function normalizeItem(it) {
  const details = it.ListingDetails || {};
  const selling = it.SellingStatus || {};
  const price = selling.CurrentPrice ?? it.BuyItNowPrice ?? it.StartPrice;
  const bo = it.BestOfferDetails || {};
  const id = txt(it.ItemID);
  return {
    item_id: id,
    title: txt(it.Title) || '(untitled listing)',
    listing_url: txt(details.ViewItemURL) || `https://www.ebay.com/itm/${id}`,
    listing_type: txt(it.ListingType),
    price_cents: toCents(price),
    currency: attr(price, 'currencyID') || null,
    quantity: toInt(it.Quantity),
    quantity_sold: toInt(selling.QuantitySold),
    watch_count: toInt(it.WatchCount),
    best_offer_enabled: txt(bo.BestOfferEnabled) === 'true' ? 1 : 0,
    best_offer_count: toInt(bo.BestOfferCount),
    start_time: txt(details.StartTime),
    end_time: txt(details.EndTime),
  };
}

async function fetchActiveListings(cfg, token) {
  const items = [];
  for (let page = 1; page <= 20; page++) {
    const resp = await trading(cfg, token, 'GetMyeBaySelling',
      `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`);
    const list = resp.ActiveList || {};
    for (const it of arr(list.ItemArray?.Item)) if (txt(it.ItemID)) items.push(normalizeItem(it));
    const pages = toInt(list.PaginationResult?.TotalNumberOfPages) || 1;
    if (page >= pages) break;
  }
  return items;
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const yyyymmdd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

// One call to eBay's traffic report. Returns [{ key, row }] where key is the listing ID
// (dimension LISTING) or the day as YYYY-MM-DD (dimension DAY), and row maps metric -> value.
async function trafficReport(cfg, token, { dimension, ids, start, end, metrics }) {
  const filter = `marketplace_ids:{${cfg.marketplace}},date_range:[${start}..${end}],listing_ids:{${ids.join('|')}}`;
  const url = `${cfg.apiBase}/sell/analytics/v1/traffic_report?dimension=${dimension}&metric=${metrics.join(',')}&filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const e = data?.errors?.[0];
    throw new EbayError(`eBay traffic report: ${e?.longMessage || e?.message || `HTTP ${res.status}`}`);
  }
  const keys = (data.header?.metrics || []).map((m) => m.key);
  const out = [];
  for (const rec of data.records || []) {
    let key = String(rec.dimensionValues?.[0]?.value ?? '');
    if (dimension === 'DAY') key = /^\d{8}$/.test(key) ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}` : key.slice(0, 10);
    const row = {};
    (rec.metricValues || []).forEach((mv, i) => { row[keys[i]] = mv?.value; });
    if (key) out.push({ key, row });
  }
  return out;
}

async function fetchTraffic(cfg, token, ids, start, end) {
  const out = new Map();
  for (const group of chunks(ids, 200)) {
    const recs = await trafficReport(cfg, token, { dimension: 'LISTING', ids: group, start, end, metrics: ['LISTING_VIEWS_TOTAL', 'LISTING_IMPRESSION_TOTAL'] });
    for (const { key, row } of recs) out.set(key, row);
  }
  return out;
}

const OFFER_STATUS = { Active: 'open', Accepted: 'accepted', Declined: 'declined' };

async function fetchBestOffers(cfg, token, itemId) {
  const resp = await trading(cfg, token, 'GetBestOffers', `<ItemID>${itemId}</ItemID><BestOfferStatus>All</BestOfferStatus>`);
  return arr(resp.BestOfferArray?.BestOffer).map((o) => ({
    external_id: txt(o.BestOfferID),
    amount_cents: toCents(o.Price),
    status: OFFER_STATUS[txt(o.Status)] || 'expired',
  })).filter((o) => o.external_id && o.amount_cents);
}

/* ------------------------------------------------ daily traffic history */
//
// Click-through rate in the app = search-results views / search-results impressions.
// Both numbers come from the same place (eBay search), so the ratio is like for like.
// eBay's own CLICK_THROUGH_RATE is stored alongside it for comparison.
//
// Two kinds of calls keep eBay usage low:
//   * Backfill: once per listing, one DAY report covering up to 90 days of history.
//   * Top-up:   one LISTING report per day for the last few days (eBay revises recent days),
//               covering up to 200 listings per call.

const DAILY_METRICS = [
  'LISTING_IMPRESSION_TOTAL',
  'LISTING_VIEWS_TOTAL',
  'LISTING_IMPRESSION_SEARCH_RESULTS_PAGE',
  'LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE',
  'CLICK_THROUGH_RATE',
];
const TOPUP_DAYS = 3;          // re-pull this many recent days each time
const BACKFILL_MAX_DAYS = 90;  // eBay's longest date range per call
const BACKFILL_PER_RUN = 10;   // listings backfilled per sync, to stay under eBay's daily call limit

const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const metric = (row, k) => { const v = Number(row?.[k]); return Number.isFinite(v) ? Math.round(v) : 0; };

// eBay's CTR can come back as a fraction (0.012) or a percentage (1.2). Store a fraction.
export function ctrFraction(raw, searchViews, searchImpressions) {
  const v = Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isFinite(v) || v < 0) return null;
  if (v > 1) return v / 100;
  if (searchImpressions > 0 && searchViews > 0 && v > (searchViews / searchImpressions) * 20) return v / 100;
  return v;
}

function trafficRow(row) {
  const search_impressions = metric(row, 'LISTING_IMPRESSION_SEARCH_RESULTS_PAGE');
  const search_views = metric(row, 'LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE');
  return {
    impressions: metric(row, 'LISTING_IMPRESSION_TOTAL'),
    views: metric(row, 'LISTING_VIEWS_TOTAL'),
    search_impressions,
    search_views,
    ebay_ctr: ctrFraction(row?.CLICK_THROUGH_RATE, search_views, search_impressions),
  };
}

function saveTraffic(env, itemId, day, t) {
  return env.DB.prepare(
    `INSERT INTO ebay_listing_traffic (item_id, report_date, watch_id, impressions, views, search_impressions, search_views, ebay_ctr, synced_at)
     VALUES (?, ?, COALESCE(
       (SELECT watch_id FROM ebay_listings WHERE item_id = ?),
       (SELECT t.watch_id FROM ebay_listing_traffic t WHERE t.item_id = ? AND t.watch_id IS NOT NULL ORDER BY t.report_date DESC LIMIT 1)
     ), ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (item_id, report_date) DO UPDATE SET
       watch_id = COALESCE(excluded.watch_id, ebay_listing_traffic.watch_id),
       impressions = excluded.impressions, views = excluded.views,
       search_impressions = excluded.search_impressions, search_views = excluded.search_views,
       ebay_ctr = excluded.ebay_ctr, synced_at = excluded.synced_at`
  ).bind(itemId, day, itemId, itemId, t.impressions, t.views, t.search_impressions, t.search_views, t.ebay_ctr);
}

// eBay's newest complete day can trail by a day; if the latest day is refused, step back one.
async function withDateFallback(fn, end) {
  try {
    return await fn(end);
  } catch (err) {
    if (err instanceof EbayError && /date/i.test(err.message)) return fn(addDays(end, -1));
    throw err;
  }
}

async function syncDailyTraffic(env, cfg, token) {
  const end = addDays(new Date(), -1);
  const recentCutoff = isoDay(addDays(end, -TOPUP_DAYS - 2));
  const oldestCutoff = isoDay(addDays(end, -BACKFILL_MAX_DAYS + 1));
  const { results: listings } = await env.DB.prepare(
    `SELECT item_id, start_time, end_time, status, traffic_backfilled_at FROM ebay_listings
     WHERE status = 'active' OR substr(COALESCE(end_time, last_seen_at, ''), 1, 10) >= ?`
  ).bind(oldestCutoff).all();
  let rows = 0;

  // 1) Backfill listings that have no history yet.
  const toBackfill = listings.filter((l) => !l.traffic_backfilled_at).slice(0, BACKFILL_PER_RUN);
  for (const l of toBackfill) {
    const started = l.start_time ? new Date(l.start_time.slice(0, 10) + 'T00:00:00Z') : addDays(end, -BACKFILL_MAX_DAYS + 1);
    const recs = await withDateFallback((e) => {
      const from = new Date(Math.min(Math.max(started.getTime(), addDays(e, -BACKFILL_MAX_DAYS + 1).getTime()), e.getTime()));
      return trafficReport(cfg, token, { dimension: 'DAY', ids: [l.item_id], start: yyyymmdd(from), end: yyyymmdd(e), metrics: DAILY_METRICS });
    }, end);
    await batch(env, [
      ...recs.map(({ key, row }) => saveTraffic(env, l.item_id, key, trafficRow(row))),
      env.DB.prepare("UPDATE ebay_listings SET traffic_backfilled_at = datetime('now') WHERE item_id = ?").bind(l.item_id),
    ]);
    rows += recs.length;
  }

  // 2) Top up the last few days for listings that are live or only just ended.
  const recent = listings
    .filter((l) => l.traffic_backfilled_at || toBackfill.includes(l))
    .filter((l) => l.status === 'active' || (l.end_time || '').slice(0, 10) >= recentCutoff)
    .map((l) => l.item_id);
  if (recent.length) {
    for (let i = TOPUP_DAYS - 1; i >= 0; i--) {
      for (const group of chunks(recent, 200)) {
        let recs;
        try {
          const day = yyyymmdd(addDays(end, -i));
          recs = await trafficReport(cfg, token, { dimension: 'LISTING', ids: group, start: day, end: day, metrics: DAILY_METRICS });
        } catch (err) {
          if (i === 0 && err instanceof EbayError && /date/i.test(err.message)) continue; // yesterday not ready yet
          throw err;
        }
        const day = isoDay(addDays(end, -i));
        await batch(env, recs.map(({ key, row }) => saveTraffic(env, key, day, trafficRow(row))));
        rows += recs.length;
      }
    }
  }
  return { backfilled: toBackfill.length, rows };
}

/* ---------------------------------------------------------- sync to D1 */

const sqliteStamp = (d = new Date()) => d.toISOString().replace('T', ' ').slice(0, 19);

async function batch(env, statements) {
  for (const group of chunks(statements, 40)) await env.DB.batch(group);
}

async function syncOffers(env, cfg, token, listing) {
  const offers = await fetchBestOffers(cfg, token, listing.item_id);
  const today = new Date().toISOString().slice(0, 10);
  await batch(env, offers.map((o) => env.DB.prepare(
    `INSERT INTO offers (watch_id, amount_cents, offered_by, offered_on, status, source, external_id)
     VALUES (?, ?, 'eBay buyer', ?, ?, 'ebay', ?)
     ON CONFLICT (source, external_id) DO UPDATE SET amount_cents = excluded.amount_cents, status = excluded.status`
  ).bind(listing.watch_id, o.amount_cents, today, o.status, o.external_id)));
  await env.DB.batch([
    env.DB.prepare(`UPDATE watches SET listing_status = 'sale_pending', updated_at = datetime('now')
      WHERE id = ? AND status = 'for_sale' AND listing_status IN ('listed', 'offer_received')
        AND EXISTS (SELECT 1 FROM offers WHERE watch_id = ? AND source = 'ebay' AND status = 'accepted')`).bind(listing.watch_id, listing.watch_id),
    env.DB.prepare(`UPDATE watches SET listing_status = 'offer_received', updated_at = datetime('now')
      WHERE id = ? AND status = 'for_sale' AND listing_status = 'listed'
        AND (SELECT COUNT(*) FROM offers WHERE watch_id = ? AND status = 'open') > 0`).bind(listing.watch_id, listing.watch_id),
    env.DB.prepare(`UPDATE watches SET listing_status = 'listed', updated_at = datetime('now')
      WHERE id = ? AND status = 'for_sale' AND listing_status = 'offer_received'
        AND (SELECT COUNT(*) FROM offers WHERE watch_id = ? AND status = 'open') = 0`).bind(listing.watch_id, listing.watch_id),
  ]);
  return offers.length;
}

// Pulls everything from eBay into D1. Throws EbayError with a readable message on failure.
// `force` refreshes views even if they were refreshed recently; runs closer than a minute apart are skipped.
export async function syncEbay(env, { force = false, quiet = false } = {}) {
  if (!isConfigured(env)) {
    if (quiet) return null;
    throw new EbayError('eBay is not set up yet.');
  }
  const conn = await env.DB.prepare('SELECT * FROM ebay_connection WHERE id = 1').first();
  if (!conn) {
    if (quiet) return null;
    throw new EbayError('eBay is not connected.');
  }
  if (conn.last_sync_at && Date.now() - Date.parse(conn.last_sync_at.replace(' ', 'T') + 'Z') < MIN_SYNC_GAP_SECONDS * 1000) {
    return { skipped: true, message: 'Synced moments ago.' };
  }

  const cfg = config(env);
  const summary = { listings: 0, ended: 0, linked: 0, offers: 0, views: 'skipped', warnings: [] };
  const stamp = sqliteStamp();
  try {
    const token = await accessToken(env, conn);

    // 1) Active listings
    const items = await fetchActiveListings(cfg, token);
    summary.listings = items.length;
    await batch(env, items.map((i) => env.DB.prepare(
      `INSERT INTO ebay_listings (item_id, title, listing_url, listing_type, price_cents, currency, quantity, quantity_sold,
         watch_count, best_offer_enabled, best_offer_count, start_time, end_time, status, last_seen_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT (item_id) DO UPDATE SET title = excluded.title, listing_url = excluded.listing_url,
         listing_type = excluded.listing_type, price_cents = excluded.price_cents, currency = excluded.currency,
         quantity = excluded.quantity, quantity_sold = excluded.quantity_sold, watch_count = excluded.watch_count,
         best_offer_enabled = excluded.best_offer_enabled, best_offer_count = excluded.best_offer_count,
         start_time = excluded.start_time, end_time = excluded.end_time, status = 'active',
         last_seen_at = excluded.last_seen_at, synced_at = excluded.synced_at`
    ).bind(i.item_id, i.title, i.listing_url, i.listing_type, i.price_cents, i.currency, i.quantity, i.quantity_sold,
      i.watch_count, i.best_offer_enabled, i.best_offer_count, i.start_time, i.end_time, stamp, stamp)));
    const ended = await env.DB.prepare(
      "UPDATE ebay_listings SET status = 'ended', synced_at = ? WHERE status = 'active' AND (last_seen_at IS NULL OR last_seen_at < ?)"
    ).bind(stamp, stamp).run();
    summary.ended = ended.meta?.changes ?? 0;

    // 2) Views, impressions and daily click-through history (refreshed every few hours; eBay limits this report to 100 calls a day)
    const trafficDue = force || !conn.last_traffic_sync_at
      || Date.now() - Date.parse(conn.last_traffic_sync_at.replace(' ', 'T') + 'Z') > TRAFFIC_REFRESH_HOURS * 3600 * 1000;
    if (trafficDue) {
      if (items.length) {
        try {
          const end = new Date(Date.now() - 86400000);
          const start30 = new Date(end.getTime() - 29 * 86400000);
          const start7 = new Date(end.getTime() - 6 * 86400000);
          const ids = items.map((i) => i.item_id);
          const [t30, t7] = [await fetchTraffic(cfg, token, ids, yyyymmdd(start30), yyyymmdd(end)), await fetchTraffic(cfg, token, ids, yyyymmdd(start7), yyyymmdd(end))];
          const num = (row, k) => { const v = Number(row?.[k]); return Number.isFinite(v) ? Math.round(v) : 0; };
          await batch(env, ids.map((id) => env.DB.prepare(
            'UPDATE ebay_listings SET views_30d = ?, impressions_30d = ?, views_7d = ? WHERE item_id = ?'
          ).bind(num(t30.get(id), 'LISTING_VIEWS_TOTAL'), num(t30.get(id), 'LISTING_IMPRESSION_TOTAL'), num(t7.get(id), 'LISTING_VIEWS_TOTAL'), id)));
          summary.views = 'ok';
        } catch (err) {
          summary.views = 'failed';
          summary.warnings.push(err instanceof EbayError ? err.message : 'Views could not be loaded.');
        }
      }
      // Daily history for click-through rate (kept even after a listing ends).
      try {
        summary.daily = await syncDailyTraffic(env, cfg, token);
      } catch (err) {
        summary.daily = 'failed';
        if (!(err instanceof EbayError)) console.error(err);
        summary.warnings.push(err instanceof EbayError ? err.message : 'Click-through history could not be loaded.');
      }
      await env.DB.prepare("UPDATE ebay_connection SET last_traffic_sync_at = datetime('now') WHERE id = 1").run();
    }

    // 3) Linked listings: offers, and keep the asking price in step with eBay
    const { results: linked } = await env.DB.prepare(
      "SELECT item_id, watch_id, price_cents, best_offer_enabled, best_offer_count FROM ebay_listings WHERE status = 'active' AND watch_id IS NOT NULL"
    ).all();
    summary.linked = linked.length;
    for (const l of linked) {
      if (l.price_cents !== null) {
        await env.DB.prepare(
          "UPDATE watches SET asking_price_cents = ?, listing_platform = 'eBay', updated_at = datetime('now') WHERE id = ? AND status = 'for_sale' AND (asking_price_cents IS NOT ? OR listing_platform IS NOT 'eBay')"
        ).bind(l.price_cents, l.watch_id, l.price_cents).run();
      }
      if (l.best_offer_enabled) {
        try {
          summary.offers += await syncOffers(env, cfg, token, l);
        } catch (err) {
          summary.warnings.push(err instanceof EbayError ? err.message : 'Offers could not be loaded.');
        }
      }
    }

    const message = summary.warnings.length ? [...new Set(summary.warnings)].join(' ') : null;
    await env.DB.prepare("UPDATE ebay_connection SET last_sync_at = datetime('now'), last_sync_ok = 1, last_sync_message = ? WHERE id = 1").bind(message).run();
    return summary;
  } catch (err) {
    const message = err instanceof EbayError ? err.message : 'The eBay sync failed unexpectedly.';
    await env.DB.prepare("UPDATE ebay_connection SET last_sync_at = datetime('now'), last_sync_ok = 0, last_sync_message = ? WHERE id = 1").bind(message).run();
    if (!(err instanceof EbayError)) console.error(err);
    throw err instanceof EbayError ? err : new EbayError(message);
  }
}

// After linking a listing to a watch, fetch its offers straight away (best effort).
export async function syncOffersForListing(env, itemId) {
  try {
    if (!isConfigured(env)) return;
    const conn = await env.DB.prepare('SELECT * FROM ebay_connection WHERE id = 1').first();
    const listing = await env.DB.prepare('SELECT item_id, watch_id, best_offer_enabled FROM ebay_listings WHERE item_id = ?').bind(itemId).first();
    if (!conn || !listing?.watch_id || !listing.best_offer_enabled) return;
    await syncOffers(env, config(env), await accessToken(env, conn), listing);
  } catch (err) {
    console.error('eBay offers fetch failed', err?.message);
  }
}
