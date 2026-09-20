// Watch Tracker: Cloudflare Worker
//
// - /api/*  JSON API backed by D1 (env.DB) and R2 (env.IMAGES)
// - anything else is served from ./public through the assets binding (env.ASSETS)
//
// Amounts are whole cents (USD) and dates are YYYY-MM-DD strings.

const STATUSES = ['wishlist', 'owned', 'for_sale', 'sold'];

// Columns the client may set on a watch. Anything not listed here is ignored,
// so column names are never taken from user input.
const WATCH_SPEC = {
  status: { t: 'enum', values: STATUSES },
  brand: { t: 'text', req: true },
  model: { t: 'text', req: true },
  reference_number: { t: 'text' },
  serial_number: { t: 'text' },
  case_size_mm: { t: 'num' },
  movement: { t: 'text' },
  water_resistance_m: { t: 'int' },
  has_box_papers: { t: 'bool' },
  condition: { t: 'text' },
  notes: { t: 'text', max: 5000 },
  purchase_date: { t: 'date' },
  purchase_price_cents: { t: 'int' },
  purchased_from: { t: 'text' },
  est_value_cents: { t: 'int' },
  est_value_updated_on: { t: 'date' },
  asking_price_cents: { t: 'int' },
  listing_platform: { t: 'text' },
  listed_date: { t: 'date' },
  listing_status: { t: 'enum', values: ['listed', 'offer_received', 'sale_pending'] },
  outcome: { t: 'enum', values: ['sold', 'traded', 'gifted', 'other'] },
  sale_price_cents: { t: 'int' },
  sale_date: { t: 'date' },
  sold_via: { t: 'text' },
  traded_for: { t: 'text' },
  priority: { t: 'enum', values: ['high', 'medium', 'low'] },
  target_price_cents: { t: 'int' },
  market_price_cents: { t: 'int' },
  source_url: { t: 'url' },
};

const SERVICE_SPEC = {
  serviced_on: { t: 'date', req: true },
  service_type: { t: 'text' },
  provider: { t: 'text' },
  cost_cents: { t: 'int' },
  next_due_on: { t: 'date' },
  notes: { t: 'text', max: 2000 },
};

const OFFER_CREATE_SPEC = {
  amount_cents: { t: 'int', req: true, min: 1 },
  offered_by: { t: 'text' },
  offered_on: { t: 'date' },
};

const OFFER_UPDATE_SPEC = {
  status: { t: 'enum', values: ['open', 'accepted', 'declined', 'expired'], req: true },
};

const LISTING_COLUMNS = ['asking_price_cents', 'listing_platform', 'listed_date', 'listing_status'];
const SALE_COLUMNS = ['outcome', 'sale_price_cents', 'sale_date', 'sold_via', 'traded_for'];

const PHOTO_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
const MAX_PHOTOS_PER_UPLOAD = 10;

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

const today = () => new Date().toISOString().slice(0, 10);

function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validates and normalizes the fields in `body` that appear in `spec`.
// For updates (partial) only keys present in the body are returned.
function clean(spec, body, partial) {
  const out = {};
  const errors = {};
  for (const [col, rule] of Object.entries(spec)) {
    if (!Object.prototype.hasOwnProperty.call(body, col)) {
      if (!partial && rule.req) errors[col] = 'Required';
      continue;
    }
    let v = body[col];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined || v === null) {
      if (rule.req) errors[col] = 'Required';
      else out[col] = rule.t === 'bool' ? 0 : null;
      continue;
    }
    switch (rule.t) {
      case 'text':
      case 'url': {
        v = String(v);
        if (v.length > (rule.max || 300)) errors[col] = 'Too long';
        else if (rule.t === 'url' && !/^https?:\/\/\S+$/i.test(v)) errors[col] = 'Enter a full web address starting with http:// or https://';
        else out[col] = v;
        break;
      }
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < (rule.min ?? 0) || n > 1e12) errors[col] = 'Enter a whole number';
        else out[col] = n;
        break;
      }
      case 'num': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1e9) errors[col] = 'Enter a number';
        else out[col] = n;
        break;
      }
      case 'bool':
        out[col] = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
        break;
      case 'date':
        if (!isRealDate(String(v))) errors[col] = 'Enter a date as YYYY-MM-DD';
        else out[col] = String(v);
        break;
      case 'enum':
        if (!rule.values.includes(v)) errors[col] = 'Not an allowed value';
        else out[col] = v;
        break;
    }
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Some fields need attention.', errors);
  return out;
}

async function readJson(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return body;
}

// Fills in sensible values when a watch enters a new status, and clears
// fields that no longer apply when it leaves one.
function applyStatusRules(values, current) {
  const next = values.status ?? current?.status ?? 'owned';
  const prev = current?.status ?? null;
  const changed = prev !== next;
  const extra = [];

  if (next === 'for_sale') {
    if (changed) {
      values.listing_status = values.listing_status || 'listed';
      values.listed_date = values.listed_date || today();
    } else {
      values.listing_status = values.listing_status || current?.listing_status || 'listed';
      values.listed_date = values.listed_date || current?.listed_date || today();
    }
  }
  if (next === 'sold') {
    values.outcome = values.outcome || current?.outcome || 'sold';
    values.sale_date = values.sale_date || current?.sale_date || today();
  }
  if (next === 'wishlist') {
    values.priority = values.priority || current?.priority || 'medium';
  }
  if (changed && prev === 'for_sale' && next !== 'sold') {
    for (const c of LISTING_COLUMNS) if (!(c in values)) values[c] = null;
  }
  if (changed && prev === 'sold') {
    for (const c of SALE_COLUMNS) if (!(c in values)) values[c] = null;
  }
  if (changed && prev === 'for_sale') extra.push('expire-offers');
  return extra;
}

async function watchExists(env, id) {
  const row = await env.DB.prepare('SELECT id FROM watches WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Watch not found.');
}

const LIST_SQL = `
  SELECT w.*,
    (SELECT p.id FROM watch_photos p WHERE p.watch_id = w.id ORDER BY p.sort_order, p.id LIMIT 1) AS primary_photo_id,
    (SELECT COUNT(*) FROM offers o WHERE o.watch_id = w.id AND o.status = 'open') AS open_offers,
    (SELECT MAX(o.amount_cents) FROM offers o WHERE o.watch_id = w.id AND o.status = 'open') AS best_offer_cents,
    (SELECT MAX(s.serviced_on) FROM service_records s WHERE s.watch_id = w.id) AS last_serviced_on,
    (SELECT s.next_due_on FROM service_records s WHERE s.watch_id = w.id ORDER BY s.serviced_on DESC, s.id DESC LIMIT 1) AS next_service_due_on
  FROM watches w
  ORDER BY w.updated_at DESC, w.id DESC`;

async function listWatches(env) {
  const { results } = await env.DB.prepare(LIST_SQL).all();
  return json({ watches: results });
}

async function loadWatch(env, id) {
  const watch = await env.DB.prepare('SELECT * FROM watches WHERE id = ?').bind(id).first();
  if (!watch) throw new HttpError(404, 'Watch not found.');
  const [photos, service, offers] = await env.DB.batch([
    env.DB.prepare('SELECT id, content_type, byte_size, sort_order FROM watch_photos WHERE watch_id = ? ORDER BY sort_order, id').bind(id),
    env.DB.prepare('SELECT * FROM service_records WHERE watch_id = ? ORDER BY serviced_on DESC, id DESC').bind(id),
    env.DB.prepare('SELECT * FROM offers WHERE watch_id = ? ORDER BY created_at DESC, id DESC').bind(id),
  ]);
  return { watch, photos: photos.results, service_records: service.results, offers: offers.results };
}

async function getWatch(env, id) {
  return json(await loadWatch(env, id));
}

async function createWatch(request, env) {
  const body = await readJson(request);
  const values = clean(WATCH_SPEC, body, false);
  values.status = values.status || 'owned';
  applyStatusRules(values, null);
  const cols = Object.keys(values);
  const res = await env.DB.prepare(
    `INSERT INTO watches (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...cols.map((c) => values[c])).run();
  return json(await loadWatch(env, res.meta.last_row_id), 201);
}

async function updateWatch(request, env, id) {
  const body = await readJson(request);
  const values = clean(WATCH_SPEC, body, true);
  const current = await env.DB.prepare('SELECT * FROM watches WHERE id = ?').bind(id).first();
  if (!current) throw new HttpError(404, 'Watch not found.');
  if (values.status === 'for_sale' && current.status !== 'for_sale' && current.status !== 'owned') {
    throw new HttpError(400, 'A watch has to be owned before it can be listed for sale.', { status: 'Move it to Owned first.' });
  }
  const extra = applyStatusRules(values, current);
  const cols = Object.keys(values);
  if (!cols.length) throw new HttpError(400, 'Nothing to update.');
  const stmts = [
    env.DB.prepare(
      `UPDATE watches SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).bind(...cols.map((c) => values[c]), id),
  ];
  if (extra.includes('expire-offers')) {
    stmts.push(env.DB.prepare("UPDATE offers SET status = 'expired' WHERE watch_id = ? AND status = 'open'").bind(id));
  }
  await env.DB.batch(stmts);
  return getWatch(env, id);
}

async function deleteWatch(env, id) {
  const { results } = await env.DB.prepare('SELECT r2_key FROM watch_photos WHERE watch_id = ?').bind(id).all();
  await watchExists(env, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM offers WHERE watch_id = ?').bind(id),
    env.DB.prepare('DELETE FROM service_records WHERE watch_id = ?').bind(id),
    env.DB.prepare('DELETE FROM watch_photos WHERE watch_id = ?').bind(id),
    env.DB.prepare('DELETE FROM watches WHERE id = ?').bind(id),
  ]);
  if (results.length) await env.IMAGES.delete(results.map((r) => r.r2_key));
  return json({ ok: true });
}

async function uploadPhotos(request, env, watchId) {
  await watchExists(env, watchId);
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, 'Upload must be multipart form data.');
  }
  const files = form.getAll('file').filter((f) => f && typeof f === 'object' && typeof f.arrayBuffer === 'function');
  if (!files.length) throw new HttpError(400, 'Choose at least one photo.');
  if (files.length > MAX_PHOTOS_PER_UPLOAD) throw new HttpError(400, `Upload up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`);

  for (const f of files) {
    const type = (f.type || '').toLowerCase();
    if (!PHOTO_TYPES[type]) throw new HttpError(400, 'Photos must be JPEG, PNG, WebP, GIF, or HEIC.');
    if (f.size > MAX_PHOTO_BYTES) throw new HttpError(413, 'Each photo must be under 12 MB.');
  }

  const saved = [];
  for (const f of files) {
    const type = f.type.toLowerCase();
    const key = `watches/${watchId}/${crypto.randomUUID()}.${PHOTO_TYPES[type]}`;
    await env.IMAGES.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: type } });
    try {
      const res = await env.DB.prepare(
        `INSERT INTO watch_photos (watch_id, r2_key, content_type, byte_size, sort_order)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM watch_photos WHERE watch_id = ?))`
      ).bind(watchId, key, type, f.size, watchId).run();
      saved.push({ id: res.meta.last_row_id, content_type: type, byte_size: f.size });
    } catch (err) {
      await env.IMAGES.delete(key);
      throw err;
    }
  }
  await env.DB.prepare("UPDATE watches SET updated_at = datetime('now') WHERE id = ?").bind(watchId).run();
  return json({ photos: saved }, 201);
}

async function servePhoto(env, id) {
  const row = await env.DB.prepare('SELECT r2_key, content_type FROM watch_photos WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Photo not found.');
  const obj = await env.IMAGES.get(row.r2_key);
  if (!obj) throw new HttpError(404, 'Photo not found.');
  const headers = new Headers({
    'content-type': row.content_type,
    'cache-control': 'private, max-age=86400',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  });
  if (obj.httpEtag) headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
}

async function deletePhoto(env, id) {
  const row = await env.DB.prepare('SELECT r2_key FROM watch_photos WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Photo not found.');
  await env.IMAGES.delete(row.r2_key);
  await env.DB.prepare('DELETE FROM watch_photos WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function makePhotoMain(env, id) {
  const row = await env.DB.prepare('SELECT watch_id FROM watch_photos WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'Photo not found.');
  const min = await env.DB.prepare('SELECT COALESCE(MIN(sort_order), 0) AS m FROM watch_photos WHERE watch_id = ?').bind(row.watch_id).first();
  await env.DB.prepare('UPDATE watch_photos SET sort_order = ? WHERE id = ?').bind(min.m - 1, id).run();
  return json({ ok: true });
}

async function addServiceRecord(request, env, watchId) {
  await watchExists(env, watchId);
  const v = clean(SERVICE_SPEC, await readJson(request), false);
  const cols = ['watch_id', ...Object.keys(v)];
  const res = await env.DB.prepare(
    `INSERT INTO service_records (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(watchId, ...Object.keys(v).map((c) => v[c])).run();
  const row = await env.DB.prepare('SELECT * FROM service_records WHERE id = ?').bind(res.meta.last_row_id).first();
  return json(row, 201);
}

async function deleteServiceRecord(env, id) {
  const res = await env.DB.prepare('DELETE FROM service_records WHERE id = ?').bind(id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Service record not found.');
  return json({ ok: true });
}

async function addOffer(request, env, watchId) {
  await watchExists(env, watchId);
  const v = clean(OFFER_CREATE_SPEC, await readJson(request), false);
  v.offered_on = v.offered_on || today();
  const cols = ['watch_id', ...Object.keys(v)];
  const res = await env.DB.prepare(
    `INSERT INTO offers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(watchId, ...Object.keys(v).map((c) => v[c])).run();
  await env.DB.prepare(
    "UPDATE watches SET listing_status = 'offer_received', updated_at = datetime('now') WHERE id = ? AND status = 'for_sale' AND listing_status = 'listed'"
  ).bind(watchId).run();
  const row = await env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(res.meta.last_row_id).first();
  return json(row, 201);
}

async function updateOffer(request, env, id) {
  const v = clean(OFFER_UPDATE_SPEC, await readJson(request), false);
  const offer = await env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
  if (!offer) throw new HttpError(404, 'Offer not found.');
  await env.DB.prepare('UPDATE offers SET status = ? WHERE id = ?').bind(v.status, id).run();
  if (v.status === 'accepted') {
    await env.DB.prepare(
      "UPDATE watches SET listing_status = 'sale_pending', updated_at = datetime('now') WHERE id = ? AND status = 'for_sale'"
    ).bind(offer.watch_id).run();
  }
  return json({ ...offer, status: v.status });
}

async function deleteOffer(env, id) {
  const res = await env.DB.prepare('DELETE FROM offers WHERE id = ?').bind(id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Offer not found.');
  return json({ ok: true });
}

async function handleApi(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  let m;

  if (path === '/api/health') return json({ ok: true });

  if (path === '/api/watches') {
    if (method === 'GET') return listWatches(env);
    if (method === 'POST') return createWatch(request, env);
  }
  if ((m = path.match(/^\/api\/watches\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'GET') return getWatch(env, id);
    if (method === 'PUT') return updateWatch(request, env, id);
    if (method === 'DELETE') return deleteWatch(env, id);
  }
  if ((m = path.match(/^\/api\/watches\/(\d+)\/photos$/)) && method === 'POST') return uploadPhotos(request, env, Number(m[1]));
  if ((m = path.match(/^\/api\/watches\/(\d+)\/service$/)) && method === 'POST') return addServiceRecord(request, env, Number(m[1]));
  if ((m = path.match(/^\/api\/watches\/(\d+)\/offers$/)) && method === 'POST') return addOffer(request, env, Number(m[1]));

  if ((m = path.match(/^\/api\/photos\/(\d+)$/))) {
    if (method === 'GET') return servePhoto(env, Number(m[1]));
    if (method === 'DELETE') return deletePhoto(env, Number(m[1]));
  }
  if ((m = path.match(/^\/api\/photos\/(\d+)\/main$/)) && method === 'POST') return makePhotoMain(env, Number(m[1]));
  if ((m = path.match(/^\/api\/service\/(\d+)$/)) && method === 'DELETE') return deleteServiceRecord(env, Number(m[1]));
  if ((m = path.match(/^\/api\/offers\/(\d+)$/))) {
    if (method === 'PUT') return updateOffer(request, env, Number(m[1]));
    if (method === 'DELETE') return deleteOffer(env, Number(m[1]));
  }

  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, fields: err.fields }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },
};
