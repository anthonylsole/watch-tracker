'use strict';

/* =====================================================================
   Watch Tracker front end. Plain JavaScript, no build step.
   All user text goes into the page through textContent (see h()), never
   through innerHTML.
   ===================================================================== */

/* ---------- DOM helpers ---------- */
const ATTR_ONLY = new Set(['list', 'form', 'style', 'role']);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'for') el.htmlFor = v;
    else if (k in el && !ATTR_ONLY.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const $ = (sel, root = document) => root.querySelector(sel);

const ICONS = {
  owned: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 7l.7-4h3.6l.7 4zM9.5 17l.7 4h3.6l.7-4z" fill="currentColor"/><circle cx="12" cy="12" r="5.5" fill="currentColor"/><path class="ko" d="M12 9.5V12l1.6 1.2" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sale: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8.5l9 9a2 2 0 0 1 0 2.8l-5.7 5.7a2 2 0 0 1-2.8 0L3 11.5z" fill="currentColor"/><circle class="ko-fill" cx="7.5" cy="7.5" r="1.6"/></svg>',
  past: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1" fill="currentColor"/><path d="M5 10.5h14V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" fill="currentColor"/><path class="ko" d="M10 13.5h4" fill="none" stroke-width="2" stroke-linecap="round"/></svg>',
  wish: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.5l-5.4 2.9 1-6.1L3.2 10l6.1-.9z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  timeline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="5.5" r="2.8" fill="currentColor"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/><circle cx="12" cy="18.5" r="2.8" fill="currentColor"/><path d="M15.8 5.5h5M3.2 12h5M15.8 18.5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  art: '<svg viewBox="0 0 208 500" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M61 175.5L73 10H135L147 175.5"/><path d="M61 324.5L73 490H135L147 324.5"/><circle cx="104" cy="250" r="86"/><path d="M104 207V250L131.5 270.6"/></svg>',
};

function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = ICONS[name];
  return t.content.firstElementChild;
}

/* ---------- formatting ---------- */
const moneyFmt = (fraction) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: fraction, maximumFractionDigits: 2 });
const money = (c) => (c === null || c === undefined ? '—' : moneyFmt(c % 100 ? 2 : 0).format(c / 100));
const signedMoney = (c) => (c === null || c === undefined ? '—' : (c > 0 ? '+' : c < 0 ? '–' : '') + money(Math.abs(c)));
const parseDay = (s) => new Date(s + 'T00:00:00');
const fmtDate = (s) => (s ? parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtMonth = (s) => (s ? parseDay(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—');
const todayStr = () => new Date().toLocaleDateString('en-CA');
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
const monthsBetween = (a, b) => Math.max(0, Math.round(daysBetween(a, b) / 30.44));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
const centsToDollars = (c) => (c === null || c === undefined ? '' : String(c / 100));
const dollarsToCents = (s) => {
  const n = Number(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const total = (list, fn) => {
  const vals = list.map(fn).filter((v) => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};
const by = (fn, dir = 1) => (a, b) => {
  const x = fn(a);
  const y = fn(b);
  if ((x === null || x === undefined) && (y === null || y === undefined)) return 0;
  if (x === null || x === undefined) return 1;
  if (y === null || y === undefined) return -1;
  return (x < y ? -1 : x > y ? 1 : 0) * dir;
};

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, isError ? 5000 : 2600);
}

/* ---------- API ---------- */
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  if (!isJson) throw new Error('Your session may have expired. Reload the page and sign in again.');
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.fields = data.fields;
    throw err;
  }
  return data;
}

/* ---------- domain helpers ---------- */
const gainOwned = (w) => (w.est_value_cents !== null && w.purchase_price_cents !== null ? w.est_value_cents - w.purchase_price_cents : null);
const gainSold = (w) => (w.outcome === 'sold' && w.sale_price_cents !== null && w.purchase_price_cents !== null ? w.sale_price_cents - w.purchase_price_cents : null);
const daysListed = (w) => (w.listed_date ? Math.max(0, daysBetween(w.listed_date, todayStr())) : null);
const heldMonths = (w) => (w.purchase_date && w.sale_date ? monthsBetween(w.purchase_date, w.sale_date) : null);
// "Held 2 yr 3 mo": how long a watch has been owned (until today, or until it was sold).
function heldLabel(w) {
  if (!w.purchase_date || w.status === 'wishlist') return null;
  const end = w.status === 'sold' ? w.sale_date : todayStr();
  if (!end) return null;
  const days = daysBetween(w.purchase_date, end);
  if (days < 0) return null;
  const a = parseDay(w.purchase_date);
  const b = parseDay(end);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  if (months < 1) return days === 0 ? 'Held less than a day' : `Held ${days} ${days === 1 ? 'day' : 'days'}`;
  const yrs = Math.floor(months / 12);
  const mos = months % 12;
  return 'Held ' + [yrs ? `${yrs} yr` : null, mos ? `${mos} mo` : null].filter(Boolean).join(' ');
}
const isServiceDue = (w) => !!w.next_service_due_on && daysBetween(todayStr(), w.next_service_due_on) <= 60;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

// eBay numbers for a watch that is linked to a listing (see the For sale page).
const linkedToEbay = (w) => !!w.ebay_item_id;
function viewsCell(w) {
  if (!linkedToEbay(w)) return '—';
  if (w.ebay_status === 'ended') return 'Ended on eBay';
  if (w.ebay_views_30d === null || w.ebay_views_30d === undefined) return '—';
  return h('span', {}, String(w.ebay_views_30d), w.ebay_views_7d !== null && w.ebay_views_7d !== undefined ? h('small', { class: 'sub' }, `${w.ebay_views_7d} in 7 days`) : null);
}
// Click-through rate = search-results views / search-results impressions (like for like).
const ctrOf = (views, imps) => (imps > 0 && views !== null && views !== undefined ? views / imps : null);
const pct = (f) => (f === null || f === undefined ? '—' : `${(f * 100).toFixed(f < 0.1 ? 2 : 1)}%`);
const intFmt = new Intl.NumberFormat('en-US');
const int = (n) => (n === null || n === undefined ? '—' : intFmt.format(n));
const listCtr = (w) => ctrOf(w.ebay_search_views_30d, w.ebay_search_impressions_30d);
function ctrCell(w) {
  const c = listCtr(w);
  if (c === null) return '—';
  return h('span', {}, pct(c), h('small', { class: 'sub' }, `${int(w.ebay_search_impressions_30d)} impr.`));
}
function offerCell(w) {
  if (!w.open_offers) return w.best_offer_cents ? money(w.best_offer_cents) : '—';
  return h('span', {}, money(w.best_offer_cents), h('small', { class: 'sub' }, `${w.open_offers} open`));
}
function ebayLine(w) {
  if (!linkedToEbay(w)) return null;
  if (w.ebay_status === 'ended') return 'Listing ended on eBay';
  const parts = [];
  if (w.ebay_views_30d !== null && w.ebay_views_30d !== undefined) parts.push(`${w.ebay_views_30d} views (30d)`);
  if (listCtr(w) !== null) parts.push(`${pct(listCtr(w))} CTR`);
  parts.push(`${w.open_offers || 0} ${w.open_offers === 1 ? 'offer' : 'offers'}`);
  return parts.join(' · ');
}

const LISTING = {
  listed: ['Listed', 'listed'],
  offer_received: ['Offer received', 'offer'],
  sale_pending: ['Sale pending', 'pending'],
};
const OUTCOMES = { sold: 'Sold', traded: 'Traded', gifted: 'Gifted', other: 'Other' };
const STATUS_LABEL = { wishlist: 'Wishlist', owned: 'Owned', for_sale: 'For sale', sold: 'Sold' };
const STATUS_ORDER = ['wishlist', 'owned', 'for_sale', 'sold'];

const gainPill = (g) => (g === null ? '—' : h('span', { class: 'pill ' + (g >= 0 ? 'gain' : 'loss') }, signedMoney(g)));
const listingPill = (w) => {
  const [label, cls] = LISTING[w.listing_status] || LISTING.listed;
  return h('span', { class: 'pill ' + cls }, label);
};
const soldPill = (w) => (w.outcome === 'sold' ? gainPill(gainSold(w)) : h('span', { class: 'pill neutral' }, OUTCOMES[w.outcome] || 'Sold'));
const priorityPill = (w) => h('span', { class: 'pill ' + (w.priority || 'medium') }, cap(w.priority || 'medium'));

/* ---------- section configuration ---------- */
const SECTIONS = {
  owned: {
    key: 'owned', status: 'owned', statuses: ['owned', 'for_sale'], label: 'Owned', title: 'My Watches', color: '#1E6F5C', bar: '#4FBF9A', icon: 'owned', layout: 'table',
    empty: ['Add your first watch', 'Track what you own, what it cost, and what it is worth today.'],
    stats(ws) {
      const gains = ws.map(gainOwned).filter((g) => g !== null);
      const gain = gains.reduce((a, b) => a + b, 0);
      return [
        ['Watches owned', String(ws.length)],
        ['Total paid', money(total(ws, (w) => w.purchase_price_cents))],
        ['Est. value', money(total(ws, (w) => w.est_value_cents))],
        ['Paper gain / loss', gains.length ? signedMoney(gain) : '—', gains.length ? (gain >= 0 ? 'pos' : 'neg') : ''],
      ];
    },
    chips: [['all', 'All', () => true], ['sale', 'For sale', (w) => w.status === 'for_sale'], ['box', 'Box + papers', (w) => w.has_box_papers === 1], ['service', 'Service due', isServiceDue]],
    sorts: [
      ['bought', 'Date bought', by((w) => w.purchase_date, -1)],
      ['recent', 'Recently updated', (a, b) => a._i - b._i],
      ['brand', 'Brand A–Z', by((w) => (w.brand + ' ' + w.model).toLowerCase())],
      ['value', 'Est. value', by((w) => w.est_value_cents, -1)],
    ],
    cols: '48px minmax(0,2.2fr) repeat(5,minmax(0,1fr)) minmax(0,1.2fr) minmax(0,1fr) 24px',
    columns: [
      ['Ref.', (w) => w.reference_number || '—'],
      ['Bought', (w) => fmtMonth(w.purchase_date)],
      ['Paid', (w) => money(w.purchase_price_cents)],
      ['Est. value', (w) => money(w.est_value_cents)],
      ['Gain / loss', (w) => gainPill(gainOwned(w))],
      ['Extras', (w) => (w.has_box_papers ? 'Box + papers' : 'Watch only')],
      ['Last serviced', (w) => fmtMonth(w.last_serviced_on)],
    ],
    pill: (w) => (w.status === 'for_sale' ? h('span', { class: 'pill listed' }, 'For sale') : null),
    pillInRow: true,
    mobileMeta: (w) => `${money(w.purchase_price_cents)} paid · ${money(w.est_value_cents)} est.`,
    cardVals: (w) => [`Paid ${money(w.purchase_price_cents)}`, `Est. ${money(w.est_value_cents)}`],
    cardSub: (w) => (w.has_box_papers ? 'Box + papers' : 'Watch only'),
  },
  'for-sale': {
    key: 'for-sale', status: 'for_sale', statuses: ['for_sale'], label: 'For sale', title: 'For Sale', color: '#A72C00', bar: '#E0603A', icon: 'sale', layout: 'table',
    empty: ['Nothing listed right now', 'Open a watch you own and choose List for sale. It stays in Owned while it is listed.'],
    stats(ws) {
      const days = ws.map(daysListed).filter((d) => d !== null);
      const tracked = ws.filter((w) => w.ebay_item_id && w.ebay_status === 'active' && w.ebay_views_30d !== null);
      const sv = ws.reduce((n, w) => n + (w.ebay_search_views_30d || 0), 0);
      const si = ws.reduce((n, w) => n + (w.ebay_search_impressions_30d || 0), 0);
      return [
        ['Watches listed', String(ws.length)],
        ['Total asking', money(total(ws, (w) => w.asking_price_cents))],
        ['Open offers', String(ws.reduce((n, w) => n + (w.open_offers || 0), 0))],
        si > 0
          ? ['Click-through rate, 30 days', pct(ctrOf(sv, si))]
          : tracked.length
          ? ['Views, last 30 days', String(tracked.reduce((n, w) => n + w.ebay_views_30d, 0))]
          : ['Avg. days listed', days.length ? String(Math.round(days.reduce((a, b) => a + b, 0) / days.length)) : '—'],
      ];
    },
    chips: [
      ['all', 'All', () => true],
      ['listed', 'Listed', (w) => w.listing_status === 'listed'],
      ['offers', 'Offers', (w) => w.listing_status === 'offer_received'],
      ['pending', 'Pending', (w) => w.listing_status === 'sale_pending'],
    ],
    sorts: [
      ['bought', 'Date bought', by((w) => w.purchase_date, -1)],
      ['recent', 'Recently updated', (a, b) => a._i - b._i],
      ['days', 'Days listed', by(daysListed, -1)],
      ['asking', 'Asking price', by((w) => w.asking_price_cents, -1)],
      ['brand', 'Brand A–Z', by((w) => (w.brand + ' ' + w.model).toLowerCase())],
    ],
    cols: '48px minmax(0,2.2fr) minmax(0,1.4fr) minmax(0,1.2fr) repeat(6,minmax(0,1fr)) 24px',
    columns: [
      ['Status', listingPill],
      ['Platform', (w) => w.listing_platform || '—'],
      ['Days listed', (w) => (daysListed(w) === null ? '—' : String(daysListed(w)))],
      ['Views (30d)', viewsCell],
      ['CTR (30d)', ctrCell],
      ['Asking', (w) => money(w.asking_price_cents)],
      ['Paid', (w) => money(w.purchase_price_cents)],
      ['Best offer', offerCell],
    ],
    pill: listingPill,
    mobileMeta: (w) => [`Asking ${money(w.asking_price_cents)}`, w.listing_platform || 'No platform yet', ebayLine(w)].filter(Boolean).join(' · '),
    cardVals: (w) => [`Asking ${money(w.asking_price_cents)}`, `Paid ${money(w.purchase_price_cents)}`],
    cardSub: (w) => ebayLine(w) || `${w.listing_platform || 'No platform yet'} · ${daysListed(w) === null ? '—' : daysListed(w)} days listed`,
  },
  past: {
    key: 'past', status: 'sold', statuses: ['sold'], label: 'Past', title: 'Past Watches', color: '#9A7000', bar: '#D4A62A', icon: 'past', layout: 'table',
    empty: ['No past watches yet', 'Watches you sell, trade, or give away will collect here with their results.'],
    stats(ws) {
      const gains = ws.map(gainSold).filter((g) => g !== null);
      const gain = gains.reduce((a, b) => a + b, 0);
      const held = ws.map(heldMonths).filter((m) => m !== null);
      return [
        ['Past watches', String(ws.length)],
        ['Total sold for', money(total(ws.filter((w) => w.outcome === 'sold'), (w) => w.sale_price_cents))],
        ['Net gain / loss', gains.length ? signedMoney(gain) : '—', gains.length ? (gain >= 0 ? 'pos' : 'neg') : ''],
        ['Avg. time held', held.length ? `${Math.round(held.reduce((a, b) => a + b, 0) / held.length)} mo` : '—'],
      ];
    },
    chips: [
      ['all', 'All', () => true],
      ['sold', 'Sold', (w) => w.outcome === 'sold'],
      ['traded', 'Traded', (w) => w.outcome === 'traded'],
      ['other', 'Other', (w) => w.outcome === 'gifted' || w.outcome === 'other'],
    ],
    sorts: [
      ['bought', 'Date bought', by((w) => w.purchase_date, -1)],
      ['sold', 'Date sold', by((w) => w.sale_date, -1)],
      ['recent', 'Recently updated', (a, b) => a._i - b._i],
      ['gain', 'Gain / loss', by(gainSold, -1)],
      ['brand', 'Brand A–Z', by((w) => (w.brand + ' ' + w.model).toLowerCase())],
    ],
    cols: '48px minmax(0,2.2fr) minmax(0,1fr) minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr) minmax(0,1.3fr) 24px',
    columns: [
      ['Outcome', (w) => OUTCOMES[w.outcome] || 'Sold'],
      ['Owned', (w) => `${fmtMonth(w.purchase_date)} – ${fmtMonth(w.sale_date)}`],
      ['Held', (w) => (heldMonths(w) === null ? '—' : `${heldMonths(w)} mo`)],
      ['Paid', (w) => money(w.purchase_price_cents)],
      ['Sold for', (w) => money(w.sale_price_cents)],
      ['Gain / loss', (w) => (w.outcome === 'sold' ? gainPill(gainSold(w)) : '—')],
      ['Sold via', (w) => (w.outcome === 'traded' ? (w.traded_for ? `For ${w.traded_for}` : 'Traded') : w.sold_via || '—')],
    ],
    pill: soldPill,
    mobileMeta: (w) => `${OUTCOMES[w.outcome] || 'Sold'} · Paid ${money(w.purchase_price_cents)} · Sold ${money(w.sale_price_cents)}`,
    cardVals: (w) => [`Paid ${money(w.purchase_price_cents)}`, `Sold ${money(w.sale_price_cents)}`],
    cardSub: (w) => `${fmtMonth(w.purchase_date)} – ${fmtMonth(w.sale_date)}`,
  },
  wishlist: {
    key: 'wishlist', status: 'wishlist', statuses: ['wishlist'], label: 'Wishlist', title: 'Wishlist', color: '#2F4E96', bar: '#7C9BE0', icon: 'wish', layout: 'grid',
    empty: ['Start your wishlist', 'Save the watches you are watching, with a target price and a link.'],
    stats(ws) {
      return [
        ['Watches wanted', String(ws.length)],
        ['Total target', money(total(ws, (w) => w.target_price_cents))],
        ['Total market', money(total(ws, (w) => w.market_price_cents))],
        ['High priority', String(ws.filter((w) => w.priority === 'high').length)],
      ];
    },
    chips: [
      ['all', 'All', () => true],
      ['high', 'High', (w) => w.priority === 'high'],
      ['medium', 'Medium', (w) => w.priority === 'medium'],
      ['low', 'Low', (w) => w.priority === 'low'],
    ],
    sorts: [
      ['added', 'Date added', by((w) => w.created_at, -1)],
      ['priority', 'Priority', by((w) => ({ high: 0, medium: 1, low: 2 })[w.priority] ?? 1)],
      ['recent', 'Recently updated', (a, b) => a._i - b._i],
      ['target', 'Target price', by((w) => w.target_price_cents, -1)],
      ['brand', 'Brand A–Z', by((w) => (w.brand + ' ' + w.model).toLowerCase())],
    ],
    cols: '48px minmax(0,2.2fr) repeat(4,minmax(0,1fr)) minmax(0,1.6fr) 24px',
    columns: [
      ['Priority', priorityPill],
      ['Ref.', (w) => w.reference_number || '—'],
      ['Target', (w) => money(w.target_price_cents)],
      ['Market', (w) => money(w.market_price_cents)],
      ['Source', (w) => (w.source_url && host(w.source_url)) || '—'],
    ],
    pill: priorityPill,
    mobileMeta: (w) => `Target ${money(w.target_price_cents)} · Market ${money(w.market_price_cents)}`,
    cardVals: (w) => [`Target ${money(w.target_price_cents)}`, `Market ${money(w.market_price_cents)}`],
    cardSub: (w) => (w.source_url && host(w.source_url)) || 'No source yet',
  },
};
const SECTION_KEYS = ['owned', 'for-sale', 'past', 'wishlist'];
const sectionForStatus = (status) => SECTION_KEYS.map((k) => SECTIONS[k]).find((s) => s.status === status);

const TIMELINE = { key: 'timeline', label: 'Timeline', title: 'Timeline', color: '#8452C4', icon: 'timeline' };
const NAV = [...SECTION_KEYS.map((k) => SECTIONS[k]), TIMELINE];
// Where the Back link and the sidebar highlight point on a watch's page: the list the
// person came from when that list contains the watch, otherwise its home section.
function backTarget(w) {
  const k = state.lastList;
  if (k === 'timeline' && w.status !== 'wishlist') return TIMELINE;
  if (SECTIONS[k] && SECTIONS[k].statuses.includes(w.status)) return SECTIONS[k];
  return w.status === 'for_sale' ? SECTIONS.owned : sectionForStatus(w.status);
}
const navCount = (item) => (item.key === 'timeline' ? state.watches.filter((w) => w.status !== 'wishlist').length : inSection(item).length);

/* ---------- state ---------- */
const state = {
  watches: [],
  loaded: false,
  route: { name: 'owned' },
  ui: {},
  detail: null,
  photoId: null,
  lastList: null,
  ebay: null,
};
let routeToken = 0;

function uiFor(sec) {
  if (!state.ui[sec.key]) {
    let layout = sec.layout;
    try { layout = localStorage.getItem('wt-layout-' + sec.key) || layout; } catch { /* storage unavailable */ }
    state.ui[sec.key] = { q: '', chip: 'all', sort: sec.sorts[0][0], layout };
  }
  return state.ui[sec.key];
}

async function loadEbayStatus() {
  try { state.ebay = await api('GET', '/ebay/status'); } catch { state.ebay = null; }
}

// "5 min ago" from a D1 timestamp (UTC, 'YYYY-MM-DD HH:MM:SS').
function timeAgo(stamp) {
  if (!stamp) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - Date.parse(stamp.replace(' ', 'T') + 'Z')) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)} min ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)} hr ago`;
  return `${Math.round(secs / 86400)} days ago`;
}

async function refresh() {
  const { watches } = await api('GET', '/watches');
  watches.forEach((w, i) => { w._i = i; });
  state.watches = watches;
  state.loaded = true;
}

const inSection = (sec) => state.watches.filter((w) => sec.statuses.includes(w.status));

/* ---------- shell ---------- */
function renderShell() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Sections' });
  for (const item of NAV) {
    nav.append(h('a', { class: 'nav-item', href: '#/' + item.key, 'data-key': item.key, style: `--c:${item.color}` },
      icon(item.icon), h('span', { class: 'label' }, item.label), h('span', { class: 'count' }, '')));
  }
  const side = h('aside', { class: 'side' },
    h('div', { class: 'wordmark' }, 'Watch Tracker'),
    h('button', { class: 'btn primary add-side', type: 'button', onclick: () => openAddWatch() }, '+ Add watch'),
    nav,
    h('div', { class: 'art', 'aria-hidden': 'true' }, icon('art')));
  $('#app').replaceChildren(h('div', { class: 'shell' }, side, h('main', { class: 'main', id: 'main' })));
}

function paintNav() {
  const active = state.route.name === 'detail'
    ? (state.detail ? backTarget(state.detail.watch).key : null)
    : state.route.name;
  for (const a of document.querySelectorAll('.nav-item')) {
    const item = NAV.find((n) => n.key === a.dataset.key);
    if (a.dataset.key === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    $('.count', a).textContent = state.loaded ? String(navCount(item)) : '';
  }
}

/* ---------- section pages ---------- */
function showSection(key) {
  const sec = SECTIONS[key];
  state.lastList = key;
  const ui = uiFor(sec);
  const main = $('#main');
  main.style.setProperty('--sec', sec.color);

  const search = h('input', {
    class: 'input', type: 'search', 'aria-label': 'Search watches', placeholder: 'Search brand, model or ref.',
    value: ui.q, oninput: (e) => { ui.q = e.target.value; paintResults(sec); },
  });
  const layoutBtn = (name, label) => h('button', {
    type: 'button', 'aria-pressed': String(ui.layout === name), onclick: () => {
      ui.layout = name;
      try { localStorage.setItem('wt-layout-' + sec.key, name); } catch { /* ignore */ }
      for (const b of $('.seg', main).children) b.setAttribute('aria-pressed', String(b.dataset.name === name));
      paintResults(sec);
    }, 'data-name': name,
  }, label);
  const sortSel = h('select', { class: 'chip', 'aria-label': 'Sort watches', onchange: (e) => { ui.sort = e.target.value; paintResults(sec); } },
    sec.sorts.map(([k, label]) => h('option', { value: k, selected: ui.sort === k }, 'Sort: ' + label)));

  main.replaceChildren(...[
    h('header', { class: 'page-head' },
      h('h1', {}, sec.title),
      h('button', { class: 'btn primary add-head', type: 'button', onclick: () => openAddWatch(sec.status) }, '+ Add watch'),
      search,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'View' }, layoutBtn('table', 'Table'), layoutBtn('grid', 'Grid')),
      sortSel),
    sec.key === 'for-sale' ? ebayBar() : null,
    h('section', { class: 'stats', id: 'stats', 'aria-label': 'Summary' }),
    h('div', { class: 'chips', id: 'chips', role: 'group', 'aria-label': 'Filter' }),
    h('section', { class: 'results', id: 'results', 'aria-live': 'polite' })].filter(Boolean));
  paintStats(sec);
  paintChips(sec);
  paintResults(sec);
}

function ebayBar() {
  const e = state.ebay;
  if (!e) return null;
  if (!e.configured) {
    return h('div', { class: 'ebay-bar' }, h('span', {}, 'eBay is not set up yet. Add your eBay keys to see views and offers for your listings here (see the README).'));
  }
  if (!e.connected) {
    return h('div', { class: 'ebay-bar' },
      h('span', {}, 'Connect your eBay account to see views and offers for your listings here. The connection is read-only.'),
      h('a', { class: 'btn small primary', href: '/api/ebay/connect' }, 'Connect eBay'));
  }
  const bad = e.last_sync_ok === 0;
  return h('div', { class: 'ebay-bar' },
    h('div', { class: 'ebay-text' },
      h('span', {}, `eBay connected · synced ${timeAgo(e.last_sync_at)}`),
      e.last_sync_message ? h('span', { class: bad ? 'ebay-msg bad' : 'ebay-msg' }, e.last_sync_message) : null),
    h('div', { class: 'ebay-actions' },
      h('button', { class: 'btn small primary', type: 'button', onclick: (ev) => syncEbayNow(ev.currentTarget) }, 'Sync now'),
      h('button', { class: 'btn small', type: 'button', onclick: disconnectEbay }, 'Disconnect')));
}

function paintStats(sec) {
  $('#stats').replaceChildren(...sec.stats(inSection(sec)).map(([k, v, tone]) =>
    h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (tone || '') }, v))));
}

function paintChips(sec) {
  const ui = uiFor(sec);
  $('#chips').replaceChildren(...sec.chips.map(([k, label]) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(ui.chip === k),
    onclick: () => { ui.chip = k; paintChips(sec); paintResults(sec); },
  }, label)));
}

function visibleWatches(sec) {
  const ui = uiFor(sec);
  const chip = sec.chips.find(([k]) => k === ui.chip) || sec.chips[0];
  const sort = sec.sorts.find(([k]) => k === ui.sort) || sec.sorts[0];
  const q = ui.q.trim().toLowerCase();
  return inSection(sec)
    .filter(chip[2])
    .filter((w) => !q || [w.brand, w.model, w.reference_number, w.serial_number].some((s) => s && s.toLowerCase().includes(q)))
    .sort(sort[2]);
}

function photoEl(w, cls) {
  if (w.primary_photo_id) {
    return h('div', { class: cls }, h('img', { src: '/api/photos/' + w.primary_photo_id, alt: `${w.brand} ${w.model}`, loading: 'lazy', decoding: 'async' }));
  }
  return h('div', { class: cls, 'aria-hidden': 'true' }, cls === 'thumb' ? 'photo' : 'No photo');
}

function rowEl(sec, w) {
  const p = sec.pill ? sec.pill(w) : null;
  const pill = p ? h('div', { class: sec.pillInRow ? 'row-pill' : 'm-pill' }, p) : null;
  return h('a', { class: 'row', href: '#/watch/' + w.id, style: `--cols:${sec.cols}` },
    photoEl(w, 'thumb'),
    h('div', { class: 'cell c-watch' },
      h('div', { class: 'brand' }, w.brand), h('div', { class: 'model' }, w.model), pill,
      h('div', { class: 'm-meta' }, sec.mobileMeta(w)),
      heldLabel(w) ? h('div', { class: 'm-held' }, heldLabel(w)) : null),
    sec.columns.map(([, render]) => h('div', { class: 'cell' }, render(w))),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
}

function cardEl(sec, w) {
  const [a, b] = sec.cardVals(w);
  return h('a', { class: 'card', href: '#/watch/' + w.id },
    photoEl(w, 'ph'),
    h('div', { class: 'card-top' }, h('span', { class: 'brand' }, w.brand), sec.pill ? sec.pill(w) : null),
    h('div', { class: 'model' }, w.model),
    h('div', { class: 'card-vals' }, h('span', {}, a), h('span', {}, b)),
    heldLabel(w) ? h('div', { class: 'card-held' }, heldLabel(w)) : null,
    h('div', { class: 'card-sub' }, sec.cardSub(w)));
}

function paintResults(sec) {
  const ui = uiFor(sec);
  const box = $('#results');
  const all = inSection(sec);
  if (!all.length) {
    box.replaceChildren(h('div', { class: 'empty' },
      h('h2', {}, sec.empty[0]), h('p', {}, sec.empty[1]),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openAddWatch(sec.status) }, '+ Add watch')));
    return;
  }
  const list = visibleWatches(sec);
  if (!list.length) {
    box.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'No watches match'), h('p', {}, 'Try a different search or filter.')));
    return;
  }
  if (ui.layout === 'grid') {
    box.replaceChildren(h('div', { class: 'cards' }, list.map((w) => cardEl(sec, w))));
    return;
  }
  box.replaceChildren(h('div', { class: 'table' },
    h('div', { class: 'thead', style: `--cols:${sec.cols}` }, h('span'), h('span', {}, 'Watch'), sec.columns.map(([label]) => h('span', {}, label)), h('span')),
    h('div', { class: 'rows' }, list.map((w) => rowEl(sec, w))),
    h('div', { class: 'tfoot' }, `Showing ${list.length} of ${all.length}`)));
}

/* ---------- timeline ---------- */
const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
let timelineOrder = 'newest';

function tlCard(w, withDate) {
  const paid = w.purchase_price_cents !== null ? `Paid ${money(w.purchase_price_cents)}` : 'Price not recorded';
  const line1 = [paid, w.purchased_from].filter(Boolean).join(' · ');
  let line2 = null;
  if (w.status === 'owned' && w.est_value_cents !== null) line2 = `Est. value ${money(w.est_value_cents)}`;
  if (w.status === 'for_sale') line2 = `Listed at ${money(w.asking_price_cents)}`;
  if (w.status === 'sold') {
    line2 = `${OUTCOMES[w.outcome] || 'Sold'} ${fmtMonth(w.sale_date)}`
      + (w.outcome === 'sold' && w.sale_price_cents !== null ? ` for ${money(w.sale_price_cents)}` : '');
  }
  return h('a', { class: 'tl-card', href: '#/watch/' + w.id },
    photoEl(w, 'thumb'),
    h('div', { class: 'tl-body' },
      withDate ? h('div', { class: 'tl-date-m' }, fmtDate(w.purchase_date)) : null,
      h('div', { class: 'brand' }, w.brand),
      h('div', { class: 'model' }, w.model),
      h('div', { class: 'tl-line' }, line1),
      line2 ? h('div', { class: 'tl-line' }, line2) : null,
      heldLabel(w) ? h('div', { class: 'tl-line tl-held' }, heldLabel(w)) : null,
      h('span', { class: 'pill status-' + w.status }, STATUS_LABEL[w.status])));
}

function showTimeline() {
  state.lastList = 'timeline';
  const main = $('#main');
  main.style.setProperty('--sec', TIMELINE.color);
  const bought = state.watches.filter((w) => w.status !== 'wishlist');
  const orderBtn = (key, label) => h('button', {
    type: 'button', 'aria-pressed': String(timelineOrder === key),
    onclick: () => { timelineOrder = key; showTimeline(); },
  }, label);
  const head = h('header', { class: 'page-head' },
    h('h1', {}, TIMELINE.title),
    h('button', { class: 'btn primary add-head', type: 'button', onclick: () => openAddWatch() }, '+ Add watch'),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Order' }, orderBtn('newest', 'Newest first'), orderBtn('oldest', 'Oldest first')));

  if (!bought.length) {
    main.replaceChildren(head, h('div', { class: 'results' }, h('div', { class: 'empty' },
      h('h2', {}, 'Your timeline starts with your first watch'),
      h('p', {}, 'Add a watch with a purchase date and it will appear here.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openAddWatch('owned') }, '+ Add watch'))));
    return;
  }

  const byDate = (a, b) => (a.purchase_date < b.purchase_date ? -1 : a.purchase_date > b.purchase_date ? 1 : a.id - b.id);
  const asc = bought.filter((w) => w.purchase_date).sort(byDate);
  const undated = bought.filter((w) => !w.purchase_date);
  const dated = timelineOrder === 'newest' ? [...asc].reverse() : asc;

  const years = new Map();
  for (const w of asc) {
    const y = w.purchase_date.slice(0, 4);
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(w);
  }
  const yearInfo = [...years].map(([year, ws]) => ({ year, count: ws.length, spent: total(ws, (w) => w.purchase_price_cents) }));
  const maxSpent = Math.max(1, ...yearInfo.map((y) => y.spent || 0));

  const stats = [
    ['Watches bought', String(bought.length)],
    ['Total spent', money(total(bought, (w) => w.purchase_price_cents))],
    ['First purchase', asc.length ? fmtMonth(asc[0].purchase_date) : '—'],
    ['Latest purchase', asc.length ? fmtMonth(asc[asc.length - 1].purchase_date) : '—'],
  ];

  const strip = yearInfo.length ? h('section', { class: 'years', 'aria-label': 'Spending by year' },
    h('h2', {}, 'Spending by year'),
    h('div', { class: 'cols' }, yearInfo.map((y) => h('div', { class: 'col' },
      h('b', {}, y.spent === null ? '—' : compactMoney.format(y.spent / 100)),
      h('div', { class: 'bar', style: `height:${Math.max(4, Math.round(((y.spent || 0) / maxSpent) * 90))}px` }),
      h('span', {}, y.year),
      h('span', {}, `${y.count} ${y.count === 1 ? 'watch' : 'watches'}`))))) : null;

  const list = h('ol', { class: 'tl', 'aria-label': 'Purchases by date' });
  let lastYear = null;
  let n = 0;
  for (const w of dated) {
    const y = w.purchase_date.slice(0, 4);
    if (y !== lastYear) {
      const info = yearInfo.find((i) => i.year === y);
      list.append(h('li', { class: 'tl-year' },
        h('span', { class: 'yr' }, y),
        h('span', { class: 'sum' }, `${info.count} ${info.count === 1 ? 'watch' : 'watches'}${info.spent === null ? '' : ' · ' + money(info.spent)}`)));
      lastYear = y;
    }
    const d = parseDay(w.purchase_date);
    list.append(h('li', { class: 'tl-item ' + (n++ % 2 === 0 ? 'left' : 'right') },
      h('div', { class: 'tl-cardcell' }, tlCard(w, true)),
      h('div', { class: 'tl-mid', 'aria-hidden': 'true' }, h('span', { class: 'tl-dot' })),
      h('div', { class: 'tl-date', 'aria-hidden': 'true' },
        h('span', { class: 'd' }, String(d.getDate())),
        h('span', { class: 'm' }, d.toLocaleDateString('en-US', { month: 'long' })))));
  }

  main.replaceChildren(...[head,
    h('section', { class: 'stats', 'aria-label': 'Summary' }, stats.map(([k, v]) => h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)))),
    strip, list,
    undated.length ? h('section', { class: 'undated' },
      h('h2', {}, 'No purchase date'),
      h('div', { class: 'undated-grid' }, undated.map((w) => tlCard(w, false)))) : null].filter(Boolean));
}

/* ---------- detail page ---------- */
async function showDetail(id, token) {
  const main = $('#main');
  let data;
  try {
    data = await api('GET', '/watches/' + id);
  } catch (err) {
    if (token !== undefined && token !== routeToken) return;
    main.replaceChildren(h('a', { class: 'back', href: '#/owned' }, '‹ My Watches'),
      h('div', { class: 'empty' }, h('h2', {}, 'Watch not found'), h('p', {}, err.message),
        h('a', { class: 'btn primary', href: '#/owned' }, 'Back to my watches')));
    return;
  }
  if (token !== undefined && token !== routeToken) return;
  if (!state.detail || state.detail.watch.id !== id) state.photoId = null;
  state.detail = data;
  const sec = sectionForStatus(data.watch.status);
  main.style.setProperty('--sec', sec.color);
  paintNav();
  renderDetail();
  window.scrollTo(0, 0);
}

async function reloadDetail() {
  const id = state.detail.watch.id;
  await refresh();
  const data = await api('GET', '/watches/' + id);
  state.detail = data;
  paintNav();
  renderDetail();
}

const kv = (k, v, cls = '') => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v ' + cls }, v));
const box = (title, ...kids) => h('section', { class: 'box' }, h('h2', {}, title), kids);

function renderDetail() {
  const { watch: w, photos, service_records: service, offers } = state.detail;
  const sec = sectionForStatus(w.status);
  const main = $('#main');

  /* gallery */
  if (!photos.some((p) => p.id === state.photoId)) state.photoId = photos[0]?.id ?? null;
  const selected = photos.find((p) => p.id === state.photoId);
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'aria-label': 'Choose photos', onchange: (e) => uploadPhotos(w.id, [...e.target.files]) });
  const openAt = (id) => openViewer(photos, photos.findIndex((p) => p.id === id), `${w.brand} ${w.model}`, (idx) => {
    // Leave the page showing the photo that was viewed last.
    if (photos[idx].id !== state.photoId) { state.photoId = photos[idx].id; renderDetail(); }
    $('.hero-btn')?.focus();
  });
  const gallery = h('div', { class: 'gallery' },
    selected
      ? h('button', { class: 'hero hero-btn', type: 'button', 'aria-label': 'Open photo viewer', onclick: () => openAt(selected.id) },
        h('img', { src: '/api/photos/' + selected.id, alt: `${w.brand} ${w.model}` }))
      : h('div', { class: 'hero' }, 'No photos yet'),
    h('div', { class: 'thumbs' },
      photos.map((p, i) => h('button', {
        type: 'button', 'aria-label': `Open photo ${i + 1} of ${photos.length}`, 'aria-current': String(p.id === state.photoId),
        onclick: () => openAt(p.id),
      }, h('img', { src: '/api/photos/' + p.id, alt: '' }))),
      h('button', { class: 'add-photo', type: 'button', onclick: () => fileInput.click() }, '+ Add'),
      fileInput),
    selected ? h('div', { class: 'photo-actions' },
      photos[0].id !== selected.id ? h('button', { class: 'btn small', type: 'button', onclick: () => photoAction('POST', `/photos/${selected.id}/main`, 'Main photo updated') }, 'Make main photo') : null,
      h('button', { class: 'btn small danger', type: 'button', onclick: () => { if (confirm('Delete this photo?')) photoAction('DELETE', '/photos/' + selected.id, 'Photo deleted'); } }, 'Delete photo')) : null);

  const notes = h('section', { class: 'panel notes' },
    h('label', { for: 'notes' }, 'Notes'),
    h('textarea', {
      id: 'notes', placeholder: 'Straps, quirks, where it lives…', maxlength: 5000,
      onchange: async (e) => {
        try { await api('PUT', '/watches/' + w.id, { notes: e.target.value }); state.detail.watch.notes = e.target.value; toast('Notes saved'); }
        catch (err) { toast(err.message, true); }
      },
    }, w.notes || ''));

  /* header */
  const sub = [w.reference_number && `Ref. ${w.reference_number}`, w.serial_number && `Serial ${w.serial_number}`].filter(Boolean).join(' · ');
  const since = (w.status === 'owned' || w.status === 'for_sale') && w.purchase_date ? `Since ${fmtMonth(w.purchase_date)}` : null;
  const statusPills = w.status === 'for_sale'
    ? [h('span', { class: 'pill status-owned' }, 'Owned'), h('span', { class: 'pill status-for_sale' }, 'For sale')]
    : [h('span', { class: 'pill status-' + w.status }, STATUS_LABEL[w.status])];
  const head = h('div', {},
    h('div', { class: 'd-brand' }, w.brand),
    h('h1', { class: 'd-model' }, w.model),
    sub ? h('div', { class: 'd-sub' }, sub) : null,
    h('div', { class: 'd-status' }, statusPills, since));

  const idx = STATUS_ORDER.indexOf(w.status);
  // A watch that is for sale is still owned, so both steps light up.
  const lit = (i) => i === idx || (w.status === 'for_sale' && STATUS_ORDER[i] === 'owned');
  const progress = h('div', { class: 'progress', style: `--bar:${sec.bar}` },
    h('div', { class: 'bars', 'aria-hidden': 'true' }, STATUS_ORDER.map((s, i) => h('i', { class: lit(i) ? 'on' : '' }))),
    h('div', { class: 'labels' }, STATUS_ORDER.map((s, i) => h('span', { class: lit(i) ? 'on' : '' }, STATUS_LABEL[s]))));

  /* actions */
  const act = (label, fn, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, label);
  const actions = h('div', { class: 'actions' },
    w.status === 'wishlist' ? act('Mark as bought', () => markBought(w), 'primary') : null,
    w.status === 'owned' ? act('List for sale', () => listForSale(w), 'primary') : null,
    w.status === 'for_sale' ? act('Mark as sold', () => markSold(w, offers), 'primary') : null,
    w.status === 'sold' ? act('Move back to owned', () => changeStatus(w, 'owned', 'Move this watch back to Owned? Its sale details will be cleared.'), 'primary') : null,
    w.status === 'owned' || w.status === 'for_sale' ? act('Log service', () => logService(w)) : null,
    w.status === 'for_sale' ? act('Add offer', () => addOffer(w)) : null,
    w.status === 'for_sale' ? act('Take off market', () => changeStatus(w, 'owned', 'Take this watch off the market? Its listing details and open offers will be cleared.')) : null,
    act('Edit', () => openEditWatch(w)),
    act('Delete', () => deleteWatch(w), 'danger'));

  /* info boxes */
  const boxes = [];
  if (w.status !== 'wishlist') {
    boxes.push(box('Purchase',
      kv('Date bought', fmtDate(w.purchase_date)), kv('Price paid', money(w.purchase_price_cents)),
      kv('Bought from', w.purchased_from || '—'), kv('Condition', w.condition || '—')));
  }
  if (w.status === 'wishlist') {
    const link = w.source_url && /^https?:\/\//i.test(w.source_url)
      ? h('a', { href: w.source_url, target: '_blank', rel: 'noopener noreferrer' }, host(w.source_url) || 'Open link') : '—';
    boxes.push(box('Wishlist',
      kv('Priority', cap(w.priority)), kv('Target price', money(w.target_price_cents)),
      kv('Market price', money(w.market_price_cents)), kv('Source', link)));
  }
  boxes.push(box('Details',
    kv('Case size', w.case_size_mm === null ? '—' : `${w.case_size_mm} mm`), kv('Movement', w.movement || '—'),
    kv('Box & papers', w.has_box_papers ? 'Yes' : 'No'), kv('Water resistance', w.water_resistance_m === null ? '—' : `${w.water_resistance_m} m`),
    w.status === 'wishlist' ? kv('Condition', w.condition || '—') : null));
  if (w.status === 'owned' || w.status === 'for_sale') {
    const g = gainOwned(w);
    boxes.push(box('Value',
      kv('Est. market value', money(w.est_value_cents)),
      kv('Paper gain / loss', signedMoney(g), g === null ? '' : g >= 0 ? 'pos' : 'neg'),
      kv('Value last updated', fmtDate(w.est_value_updated_on))));
  }
  if (w.status === 'for_sale') {
    const d = daysListed(w);
    boxes.push(box('Listing',
      kv('Status', h('span', { class: 'pill ' + (LISTING[w.listing_status] || LISTING.listed)[1] }, (LISTING[w.listing_status] || LISTING.listed)[0])),
      kv('Asking price', money(w.asking_price_cents)), kv('Platform', w.listing_platform || '—'),
      kv('Listed', w.listed_date ? `${fmtDate(w.listed_date)} (${d} days)` : '—')));
    boxes.push(ebayBox(w, state.detail.ebay));
    boxes.push(offersBox(w, offers));
  }
  if (w.status === 'sold') {
    const g = gainSold(w);
    boxes.push(box('Sale',
      kv('Outcome', OUTCOMES[w.outcome] || 'Sold'), kv('Sold for', money(w.sale_price_cents)),
      kv('Date', fmtDate(w.sale_date)),
      w.outcome === 'traded' ? kv('Traded for', w.traded_for || '—') : kv('Sold via', w.sold_via || '—'),
      kv('Gain / loss', w.outcome === 'sold' ? signedMoney(g) : '—', g === null || w.outcome !== 'sold' ? '' : g >= 0 ? 'pos' : 'neg'),
      kv('Time held', heldMonths(w) === null ? '—' : `${heldMonths(w)} mo`)));
  }
  const ctr = ctrBox(w, state.detail.ebay, state.detail.traffic || []);
  if (ctr) boxes.push(ctr);
  if (w.status !== 'wishlist') boxes.push(serviceBox(w, service));

  main.replaceChildren(
    h('a', { class: 'back', href: '#/' + backTarget(w).key }, `‹ ${backTarget(w).title}`),
    h('div', { class: 'detail' },
      h('div', { class: 'd-left' }, gallery, notes),
      h('div', { class: 'd-right' }, head, progress, actions, h('div', { class: 'info' }, boxes))));
}

function serviceBox(w, service) {
  const rows = service.length
    ? service.map((s) => h('div', { class: 'kv' },
      h('span', { class: 'k' }, fmtDate(s.serviced_on)),
      h('span', { class: 'v' }, [s.service_type || 'Service', s.cost_cents !== null ? money(s.cost_cents) : null].filter(Boolean).join(' · ')),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Delete service record', onclick: async () => {
        if (!confirm('Delete this service record?')) return;
        try { await api('DELETE', '/service/' + s.id); await reloadDetail(); toast('Service record deleted'); } catch (err) { toast(err.message, true); }
      } }, '×')))
    : [h('div', { class: 'empty-note' }, 'No service recorded yet.')];
  const next = service[0]?.next_due_on;
  return box('Service log', rows, next ? kv('Next due', fmtDate(next), '') : null,
    h('div', { class: 'foot' }, h('button', { class: 'btn small', type: 'button', onclick: () => logService(w) }, 'Log service')));
}

function offersBox(w, offers) {
  const lines = offers.length
    ? offers.map((o) => h('div', { class: 'offer-line' },
      h('div', { class: 'top' }, h('strong', {}, money(o.amount_cents)), h('span', {}, `${cap(o.status)} · ${fmtDate(o.offered_on)}`)),
      o.source === 'ebay' ? h('div', {}, 'Offer on eBay') : (o.offered_by ? h('div', {}, `From ${o.offered_by}`) : null),
      o.source === 'ebay'
        ? (o.status === 'open' ? h('div', { class: 'ebay-note' }, 'Respond to this offer on eBay. It updates here after the next sync.') : null)
        : h('div', { class: 'btns' },
          o.status === 'open' ? h('button', { class: 'btn small', type: 'button', onclick: () => offerAction(o.id, 'PUT', { status: 'accepted' }, 'Offer accepted') }, 'Accept') : null,
          o.status === 'open' ? h('button', { class: 'btn small', type: 'button', onclick: () => offerAction(o.id, 'PUT', { status: 'declined' }, 'Offer declined') }, 'Decline') : null,
          h('button', { class: 'btn small danger', type: 'button', onclick: () => { if (confirm('Delete this offer?')) offerAction(o.id, 'DELETE', undefined, 'Offer deleted'); } }, 'Delete'))))
    : [h('div', { class: 'empty-note' }, 'No offers yet.')];
  return box('Offers', lines, h('div', { class: 'foot' }, h('button', { class: 'btn small', type: 'button', onclick: () => addOffer(w) }, 'Add offer')));
}

const isEbayUrl = (u) => /^https:\/\/([\w-]+\.)*ebay\.[a-z.]+\//i.test(u || '');

function ebayBox(w, ebay) {
  const e = state.ebay;
  if (!ebay) {
    if (!e || !e.configured) return box('eBay listing', h('div', { class: 'empty-note' }, 'eBay is not set up yet. See the README to add your eBay keys.'));
    if (!e.connected) return box('eBay listing', h('div', { class: 'empty-note' }, 'Connect eBay on the For sale page to pull views and offers for this watch.'),
      h('div', { class: 'foot' }, h('a', { class: 'btn small', href: '/api/ebay/connect' }, 'Connect eBay')));
    return box('eBay listing', h('div', { class: 'empty-note' }, 'Not linked to an eBay listing yet.'),
      h('div', { class: 'foot' }, h('button', { class: 'btn small', type: 'button', onclick: () => linkEbayListing(w) }, 'Link eBay listing')));
  }
  const ended = ebay.status === 'ended';
  const num = (v) => (v === null || v === undefined ? '—' : String(v));
  return box('eBay listing',
    ended ? h('div', { class: 'empty-note' }, 'This listing has ended on eBay. If it sold, mark the watch as sold; otherwise take it off the market or relist it.') : null,
    kv('Listing', isEbayUrl(ebay.listing_url) ? h('a', { href: ebay.listing_url, target: '_blank', rel: 'noopener noreferrer' }, `View on eBay (${ebay.item_id})`) : ebay.item_id),
    kv('eBay price', money(ebay.price_cents)),
    kv('Views, last 7 days', num(ebay.views_7d)),
    kv('Views, last 30 days', num(ebay.views_30d)),
    kv('Impressions, 30 days', num(ebay.impressions_30d)),
    kv('Watchers', num(ebay.watch_count)),
    kv('Offers on eBay', ebay.best_offer_enabled ? num(ebay.best_offer_count) : 'Best Offer is off'),
    kv(ended ? 'Ended' : 'Ends', ebay.end_time ? fmtDate(ebay.end_time.slice(0, 10)) : '—'),
    kv('Last synced', timeAgo(ebay.synced_at)),
    h('div', { class: 'foot' },
      h('button', { class: 'btn small', type: 'button', onclick: (ev) => syncEbayNow(ev.currentTarget) }, 'Sync now'),
      h('button', { class: 'btn small danger', type: 'button', onclick: () => unlinkEbayListing(w) }, 'Unlink')));
}

/* ---------- click-through rate ---------- */
// CTR = search-results views / search-results impressions, per day, from eBay's traffic report.
// History is stored per watch, so it stays after the watch sells.

const CTR_RANGES = [['30', '30 days', 30], ['90', '90 days', 90], ['all', 'All', Infinity]];
const dayAdd = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const fmtShort = (s) => parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Sums a list of daily rows into one CTR (never averages daily percentages).
function sumTraffic(rows) {
  let sv = 0, si = 0, v = 0, i = 0, ew = 0, ewi = 0;
  for (const r of rows) {
    sv += r.search_views || 0; si += r.search_impressions || 0; v += r.views || 0; i += r.impressions || 0;
    if (r.ebay_ctr !== null && r.ebay_ctr !== undefined && r.search_impressions > 0) { ew += r.ebay_ctr * r.search_impressions; ewi += r.search_impressions; }
  }
  return { search_views: sv, search_impressions: si, views: v, impressions: i, ctr: ctrOf(sv, si), ebay_ctr: ewi > 0 ? ew / ewi : null };
}

// Every calendar day from the first to the last stored day (days eBay had nothing for are empty).
function dailySeries(traffic, rangeDays) {
  if (!traffic.length) return [];
  const byDay = new Map(traffic.map((r) => [r.report_date, r]));
  const last = traffic[traffic.length - 1].report_date;
  let first = traffic[0].report_date;
  if (Number.isFinite(rangeDays)) { const from = dayAdd(last, -(rangeDays - 1)); if (from > first) first = from; }
  const out = [];
  for (let d = first; d <= last; d = dayAdd(d, 1)) {
    const r = byDay.get(d);
    out.push({ date: d, row: r || null, ctr: r ? ctrOf(r.search_views, r.search_impressions) : null });
  }
  return out;
}

function niceMax(v) {
  if (!(v > 0)) return 0.01;
  const steps = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1];
  return steps.find((s) => s >= v * 1.1) || 1;
}

function drawCtrChart(wrap, series) {
  const W = Math.max(260, wrap.clientWidth), H = 200;
  const m = { t: 12, r: 12, b: 28, l: 48 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = series.length;
  const max = niceMax(Math.max(0, ...series.map((d) => d.ctr ?? 0)));
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => m.t + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];

  // Line segments break on days with no search impressions.
  const segs = [];
  let cur = [];
  series.forEach((d, i) => {
    if (d.ctr === null) { if (cur.length) segs.push(cur); cur = []; }
    else cur.push(`${x(i).toFixed(1)},${y(d.ctr).toFixed(1)}`);
  });
  if (cur.length) segs.push(cur);
  const lines = segs.map((pts) => pts.length === 1
    ? `<circle cx="${pts[0].split(',')[0]}" cy="${pts[0].split(',')[1]}" r="3" class="ctr-dot"/>`
    : `<polyline points="${pts.join(' ')}" class="ctr-line"/>`).join('');
  const xIdx = n <= 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const xLabels = xIdx.map((i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}">${fmtShort(series[i].date)}</text>`).join('');
  const grid = ticks.map((t) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'ctr-base' : 'ctr-grid'}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${pct(t)}</text>`).join('');

  wrap.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily click-through rate, ${fmtShort(series[0].date)} to ${fmtShort(series[n - 1].date)}">
    <g class="ctr-axis">${grid}${xLabels}</g>${lines}
    <line class="ctr-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
    <circle class="ctr-hover" r="5" visibility="hidden"/>
    <rect class="ctr-hit" x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent"/></svg>
    <div class="ctr-tip" hidden></div>`;

  const svg = wrap.querySelector('svg'), tip = wrap.querySelector('.ctr-tip');
  const cross = svg.querySelector('.ctr-cross'), dot = svg.querySelector('.ctr-hover');
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left - m.l) / iw) * (n - 1))));
    const d = series[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    if (d.ctr !== null) { dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(d.ctr)); dot.setAttribute('visibility', 'visible'); }
    else dot.setAttribute('visibility', 'hidden');
    tip.replaceChildren();
    add(tip, [
      h('div', { class: 'tip-date' }, fmtDate(d.date)),
      d.row
        ? [h('div', { class: 'tip-big' }, d.ctr === null ? 'No search impressions' : `${pct(d.ctr)} CTR`),
          h('div', {}, `${int(d.row.search_views)} views from ${int(d.row.search_impressions)} search impressions`),
          d.row.ebay_ctr !== null && d.row.ebay_ctr !== undefined ? h('div', { class: 'tip-muted' }, `eBay's figure: ${pct(d.row.ebay_ctr)}`) : null]
        : h('div', { class: 'tip-muted' }, 'No data from eBay')]);
    tip.hidden = false;
    const tx = x(i) + 12 + tip.offsetWidth > W ? x(i) - 12 - tip.offsetWidth : x(i) + 12;
    tip.style.left = `${Math.max(0, tx)}px`;
  };
  const hit = svg.querySelector('.ctr-hit');
  hit.addEventListener('pointermove', (e) => show(e.clientX));
  hit.addEventListener('pointerdown', (e) => show(e.clientX));
  hit.addEventListener('pointerleave', hide);
}

function ctrBox(w, ebay, traffic) {
  const hasData = traffic.some((r) => r.search_impressions > 0 || r.impressions > 0);
  if (!hasData) {
    if (w.status === 'for_sale' && ebay) {
      return h('section', { class: 'box ctr-box' }, h('h2', {}, 'Click-through rate'),
        h('div', { class: 'empty-note' }, 'Daily history loads with the next eBay sync. Choose Sync now in the eBay listing box to load it straight away.'));
    }
    return null;
  }
  const ui = (state.ctrRange ||= '30');
  const range = CTR_RANGES.find(([k]) => k === ui) || CTR_RANGES[0];
  const series = dailySeries(traffic, range[2]);
  const t = sumTraffic(series.map((d) => d.row).filter(Boolean));
  const all = sumTraffic(traffic);
  const rangeLabel = range[0] === 'all' ? 'all time' : `last ${range[1]}`;

  const chartWrap = h('div', { class: 'ctr-chart' });
  const table = h('details', { class: 'ctr-table' }, h('summary', {}, 'Daily numbers'),
    h('div', { class: 'ctr-scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Day', 'Search impr.', 'Search views', 'CTR', "eBay's CTR", 'All impr.', 'All views'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', {}, [...series].reverse().filter((d) => d.row).map((d) => h('tr', {},
        h('td', {}, fmtDate(d.date)), h('td', {}, int(d.row.search_impressions)), h('td', {}, int(d.row.search_views)),
        h('td', {}, pct(d.ctr)), h('td', {}, pct(d.row.ebay_ctr)), h('td', {}, int(d.row.impressions)), h('td', {}, int(d.row.views))))))));

  const boxEl = h('section', { class: 'box ctr-box' },
    h('div', { class: 'ctr-head' },
      h('h2', {}, 'Click-through rate'),
      h('div', { class: 'ctr-seg', role: 'group', 'aria-label': 'Date range' }, CTR_RANGES.map(([k, label]) => h('button', {
        type: 'button', 'aria-pressed': String(k === range[0]), onclick: () => { state.ctrRange = k; renderDetail(); },
      }, label)))),
    h('div', { class: 'ctr-figs' },
      h('div', { class: 'ctr-fig' }, h('div', { class: 'k' }, `CTR, ${rangeLabel}`), h('div', { class: 'v' }, pct(t.ctr)),
        h('div', { class: 's' }, `${int(t.search_views)} views from ${int(t.search_impressions)} search impressions`)),
      h('div', { class: 'ctr-fig' }, h('div', { class: 'k' }, `eBay's figure, ${rangeLabel}`), h('div', { class: 'v' }, pct(t.ebay_ctr)),
        h('div', { class: 's' }, 'Reported by eBay, for comparison')),
      range[0] === 'all' ? null : h('div', { class: 'ctr-fig' }, h('div', { class: 'k' }, w.status === 'sold' ? 'CTR, whole listing' : 'CTR, since listed'), h('div', { class: 'v' }, pct(all.ctr)),
        h('div', { class: 's' }, `${int(all.search_views)} views from ${int(all.search_impressions)} search impressions`))),
    chartWrap,
    h('p', { class: 'ctr-note' }, 'Search views ÷ search impressions, by day. Gaps are days with no search impressions. eBay reports each day about a day late.'),
    table);

  // Draw once the box is on the page, and redraw when its width changes.
  requestAnimationFrame(() => {
    if (!chartWrap.isConnected) return;
    drawCtrChart(chartWrap, series);
    let lastW = chartWrap.clientWidth;
    new ResizeObserver(() => { if (chartWrap.isConnected && chartWrap.clientWidth !== lastW) { lastW = chartWrap.clientWidth; drawCtrChart(chartWrap, series); } }).observe(chartWrap);
  });
  return boxEl;
}

/* ---------- photo viewer ---------- */
// Full-screen overlay for a watch's photos. Left/right arrow keys (or the buttons,
// or a swipe on a touch screen) move between photos; Escape or a click outside closes it.
function openViewer(photos, startIndex, label, onClose) {
  let i = Math.max(0, startIndex);
  const img = h('img', { class: 'vw-img' });
  const count = h('div', { class: 'vw-count', 'aria-live': 'polite' });
  const single = photos.length < 2;
  const go = (d) => { i = (i + d + photos.length) % photos.length; show(); };
  const navBtn = (cls, text, aria, d) => h('button', { class: 'vw-nav ' + cls, type: 'button', 'aria-label': aria, hidden: single, onclick: () => go(d) }, text);
  const closeBtn = h('button', { class: 'vw-close', type: 'button', 'aria-label': 'Close photo viewer', onclick: () => dlg.close() }, '×');
  const dlg = h('dialog', { class: 'viewer', 'aria-label': `Photos of ${label}` },
    closeBtn,
    h('div', { class: 'vw-cap' }, label),
    navBtn('prev', '‹', 'Previous photo', -1),
    h('figure', { class: 'vw-fig' }, img),
    navBtn('next', '›', 'Next photo', 1),
    count);

  function show() {
    img.classList.remove('ready');
    img.alt = `${label}, photo ${i + 1} of ${photos.length}`;
    img.src = '/api/photos/' + photos[i].id;
    count.textContent = `${i + 1} / ${photos.length}`;
    for (const d of [-1, 1]) new Image().src = '/api/photos/' + photos[(i + d + photos.length) % photos.length].id;
  }
  img.addEventListener('load', () => img.classList.add('ready'));

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (!single) go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (!single) go(1); }
    else if (e.key === 'Home') { e.preventDefault(); i = 0; show(); }
    else if (e.key === 'End') { e.preventDefault(); i = photos.length - 1; show(); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.classList.contains('vw-fig')) dlg.close(); });
  let startX = null;
  dlg.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  dlg.addEventListener('touchend', (e) => {
    if (startX === null || single) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
  dlg.addEventListener('close', () => { dlg.remove(); onClose(i); });

  show();
  document.body.append(dlg);
  dlg.showModal();
}

/* ---------- actions ---------- */
async function guarded(fn, okMessage) {
  try { await fn(); if (okMessage) toast(okMessage); } catch (err) { toast(err.message, true); }
}

const photoAction = (method, path, msg) => guarded(async () => { await api(method, path); await reloadDetail(); }, msg);
const offerAction = (id, method, body, msg) => guarded(async () => { await api(method, '/offers/' + id, body); await reloadDetail(); }, msg);

async function prepareImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.type === 'image/jpeg' && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob ? new File([blob], (file.name.replace(/\.\w+$/, '') || 'photo') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

async function uploadPhotos(watchId, files) {
  if (!files.length) return;
  toast(files.length > 1 ? 'Uploading photos…' : 'Uploading photo…');
  await guarded(async () => {
    const fd = new FormData();
    for (const f of files) fd.append('file', await prepareImage(f));
    await api('POST', `/watches/${watchId}/photos`, fd);
    await reloadDetail();
  }, files.length > 1 ? 'Photos added' : 'Photo added');
}

async function updateWatch(id, patch, message) {
  await api('PUT', '/watches/' + id, patch);
  await reloadDetail();
  if (message) toast(message);
}

async function changeStatus(w, status, question) {
  if (!confirm(question)) return;
  await guarded(() => updateWatch(w.id, { status }), status === 'owned' ? 'Moved to Owned' : 'Updated');
}

async function deleteWatch(w) {
  if (!confirm(`Delete ${w.brand} ${w.model}? Its photos, offers, and service records will be deleted too.`)) return;
  await guarded(async () => {
    await api('DELETE', '/watches/' + w.id);
    await refresh();
    location.hash = '#/' + backTarget(w).key;
    toast('Watch deleted');
  });
}

function rerender() {
  const r = state.route;
  if (r.name === 'detail') return reloadDetail();
  if (r.name === 'timeline') return showTimeline();
  return showSection(r.name);
}

async function syncEbayNow(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    const r = await api('POST', '/ebay/sync');
    await Promise.all([refresh(), loadEbayStatus()]);
    await rerender();
    if (r.skipped) toast(r.message);
    else if (r.warnings?.length) toast(`Synced with a warning: ${r.warnings[0]}`, true);
    else toast(`Synced ${r.listings} eBay ${r.listings === 1 ? 'listing' : 'listings'}`);
  } catch (err) {
    await loadEbayStatus();
    await rerender();
    toast(err.message, true);
  }
}

async function disconnectEbay() {
  if (!confirm('Disconnect eBay? Views and offers stop updating. Your watches are not affected.')) return;
  await guarded(async () => { await api('POST', '/ebay/disconnect'); await loadEbayStatus(); await rerender(); }, 'eBay disconnected');
}

// Suggests the listing whose title mentions the watch's brand and model (or its reference number).
function suggestListing(w, listings) {
  const words = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const needle = words(`${w.brand} ${w.model}`);
  const ref = (w.reference_number || '').toLowerCase();
  return listings.find((l) => {
    const hay = words(l.title);
    return (needle.length && needle.every((t) => hay.includes(t))) || (ref.length > 2 && l.title.toLowerCase().includes(ref));
  }) || null;
}

async function linkEbayListing(w) {
  let listings;
  try { ({ listings } = await api('GET', '/ebay/listings')); } catch (err) { toast(err.message, true); return; }
  const free = listings.filter((l) => !l.watch_id);
  if (!free.length) { toast('No unlinked eBay listings found. Use Sync now on the For sale page, then try again.', true); return; }
  const guess = suggestListing(w, free);
  openForm({
    title: 'Link eBay listing', submitLabel: 'Link listing',
    hint: guess ? 'I picked the listing whose title matches this watch. Change it if it is wrong.' : 'Pick the eBay listing for this watch.',
    groups: [{ fields: [{
      name: 'item_id', label: 'Your eBay listing', type: 'select', required: true,
      options: [['', 'Choose a listing…'], ...free.map((l) => [l.item_id, `${l.title} · ${money(l.price_cents)}`])],
    }] }],
    values: { item_id: guess ? guess.item_id : '' },
    onSubmit: async (v) => { await api('POST', `/watches/${w.id}/ebay`, { item_id: v.item_id }); await reloadDetail(); toast('eBay listing linked'); },
  });
}

async function unlinkEbayListing(w) {
  if (!confirm('Unlink this eBay listing? The watch stays for sale; views and offers from eBay stop updating.')) return;
  await guarded(async () => { await api('DELETE', `/watches/${w.id}/ebay`); await reloadDetail(); }, 'Listing unlinked');
}

function listForSale(w) {
  openForm({
    title: 'List for sale', submitLabel: 'List watch',
    groups: [{ fields: [
      { name: 'asking_price_cents', label: 'Asking price', type: 'money', required: true },
      { name: 'listing_platform', label: 'Platform', type: 'text', placeholder: 'Chrono24, eBay, a forum…' },
      { name: 'listed_date', label: 'Listed on', type: 'date' },
    ] }],
    values: { asking_price_cents: w.est_value_cents ?? null, listed_date: todayStr() },
    onSubmit: (v) => updateWatch(w.id, { status: 'for_sale', ...v }, 'Listed for sale'),
  });
}

function markSold(w, offers) {
  const best = offers.filter((o) => o.status === 'accepted' || o.status === 'open').map((o) => o.amount_cents).sort((a, b) => b - a)[0];
  openForm({
    title: 'Mark as sold', submitLabel: 'Save sale',
    groups: [{ fields: [
      { name: 'outcome', label: 'What happened', type: 'select', options: Object.entries(OUTCOMES) },
      { name: 'sale_price_cents', label: 'Sold for (or trade value)', type: 'money' },
      { name: 'sale_date', label: 'Date', type: 'date' },
      { name: 'sold_via', label: 'Sold via', type: 'text', placeholder: 'Platform or buyer' },
      { name: 'traded_for', label: 'Traded for', type: 'text', placeholder: 'Only if you traded it' },
    ] }],
    values: { outcome: 'sold', sale_price_cents: best ?? w.asking_price_cents ?? null, sale_date: todayStr(), sold_via: w.listing_platform || '' },
    onSubmit: (v) => updateWatch(w.id, { status: 'sold', ...v }, 'Moved to Past'),
  });
}

function markBought(w) {
  openForm({
    title: 'Mark as bought', submitLabel: 'Move to Owned',
    groups: [{ fields: [
      { name: 'purchase_date', label: 'Date bought', type: 'date' },
      { name: 'purchase_price_cents', label: 'Price paid', type: 'money' },
      { name: 'purchased_from', label: 'Bought from', type: 'text', placeholder: 'Seller or platform' },
    ] }],
    values: { purchase_date: todayStr(), purchase_price_cents: w.target_price_cents ?? null },
    onSubmit: (v) => updateWatch(w.id, { status: 'owned', ...v }, 'Moved to Owned'),
  });
}

function logService(w) {
  openForm({
    title: 'Log service', submitLabel: 'Save record',
    groups: [{ fields: [
      { name: 'serviced_on', label: 'Date serviced', type: 'date', required: true },
      { name: 'service_type', label: 'Type of service', type: 'text', placeholder: 'Full service, battery, strap…' },
      { name: 'provider', label: 'Serviced by', type: 'text' },
      { name: 'cost_cents', label: 'Cost', type: 'money' },
      { name: 'next_due_on', label: 'Next service due', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ] }],
    values: { serviced_on: todayStr() },
    onSubmit: async (v) => { await api('POST', `/watches/${w.id}/service`, v); await reloadDetail(); toast('Service record saved'); },
  });
}

function addOffer(w) {
  openForm({
    title: 'Add offer', submitLabel: 'Save offer',
    groups: [{ fields: [
      { name: 'amount_cents', label: 'Offer amount', type: 'money', required: true },
      { name: 'offered_by', label: 'From', type: 'text', placeholder: 'Name or username' },
      { name: 'offered_on', label: 'Date', type: 'date' },
    ] }],
    values: { offered_on: todayStr() },
    onSubmit: async (v) => { await api('POST', `/watches/${w.id}/offers`, v); await reloadDetail(); toast('Offer saved'); },
  });
}

/* ---------- add / edit watch ---------- */
const CONDITIONS = [['', 'Not set'], ['New', 'New'], ['Pre-owned', 'Pre-owned']];

function watchGroups(listable = true) {
  return [
    { fields: [
      { name: 'brand', label: 'Brand', type: 'text', required: true, placeholder: 'Brand name' },
      { name: 'model', label: 'Model', type: 'text', required: true, placeholder: 'Model name' },
      { name: 'reference_number', label: 'Reference #', type: 'text', half: true },
      { name: 'serial_number', label: 'Serial # (optional)', type: 'text', half: true },
    ] },
    { title: 'Purchase details', showFor: ['owned', 'sold'], fields: [
      { name: 'purchase_date', label: 'Date bought', type: 'date', half: true },
      { name: 'purchase_price_cents', label: 'Price paid', type: 'money', half: true },
      { name: 'purchased_from', label: 'Bought from', type: 'text', placeholder: 'Seller or platform' },
    ] },
    { title: 'For sale', showWhen: ({ status }) => status === 'owned' && listable, fields: [
      { name: 'list_for_sale', label: 'This watch is currently for sale', type: 'checkbox' },
    ] },
    { title: 'Listing', showWhen: ({ status, checked }) => status === 'owned' && listable && checked('list_for_sale'), fields: [
      { name: 'asking_price_cents', label: 'Asking price', type: 'money', half: true },
      { name: 'listing_platform', label: 'Platform', type: 'text', half: true },
      { name: 'listed_date', label: 'Listed on', type: 'date', half: true },
      { name: 'listing_status', label: 'Listing status', type: 'select', half: true, options: Object.entries(LISTING).map(([k, v]) => [k, v[0]]) },
    ] },
    { title: 'Sale', showFor: ['sold'], fields: [
      { name: 'outcome', label: 'What happened', type: 'select', half: true, options: Object.entries(OUTCOMES) },
      { name: 'sale_price_cents', label: 'Sold for', type: 'money', half: true },
      { name: 'sale_date', label: 'Date', type: 'date', half: true },
      { name: 'sold_via', label: 'Sold via', type: 'text', half: true },
      { name: 'traded_for', label: 'Traded for', type: 'text' },
    ] },
    { title: 'Wishlist', showFor: ['wishlist'], fields: [
      { name: 'priority', label: 'Priority', type: 'select', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] },
      { name: 'target_price_cents', label: 'Target price', type: 'money', half: true },
      { name: 'market_price_cents', label: 'Market price', type: 'money', half: true },
      { name: 'source_url', label: 'Link', type: 'url', placeholder: 'https://…' },
    ] },
    { title: 'Details', fields: [
      { name: 'case_size_mm', label: 'Case size (mm)', type: 'number', half: true },
      { name: 'water_resistance_m', label: 'Water resistance (m)', type: 'number', half: true },
      { name: 'movement', label: 'Movement', type: 'text', placeholder: 'Automatic, quartz, manual…' },
      { name: 'condition', label: 'Condition', type: 'select', options: CONDITIONS },
      { name: 'has_box_papers', label: 'Box and papers included', type: 'checkbox' },
    ] },
    { title: 'Value', showFor: ['owned'], fields: [
      { name: 'est_value_cents', label: 'Estimated market value', type: 'money', half: true },
      { name: 'est_value_updated_on', label: 'Value as of', type: 'date', half: true },
    ] },
    { fields: [{ name: 'notes', label: 'Notes', type: 'textarea' }] },
  ];
}

function openAddWatch(status = null) {
  const sec = status ? sectionForStatus(status) : (SECTIONS[state.route.name] || SECTIONS.owned);
  const forSale = sec.status === 'for_sale';
  const initial = forSale ? 'owned' : sec.status;   // a watch for sale is an owned watch
  openForm({
    title: 'Add watch', submitLabel: 'Save watch', statusPicker: initial,
    hint: 'You can add photos after saving.',
    groups: watchGroups(),
    values: { purchase_date: initial === 'owned' ? todayStr() : '', priority: 'medium', listing_status: 'listed', outcome: 'sold', list_for_sale: forSale },
    onSubmit: async (payload) => {
      const created = await api('POST', '/watches', payload);
      await refresh();
      toast('Watch added');
      location.hash = '#/watch/' + created.watch.id;
    },
  });
}

// Empty database values would otherwise blank the select boxes for fields that
// only apply to another status (priority, outcome, listing status).
function withDefaults(w) {
  const filled = Object.fromEntries(Object.entries(w).filter(([, v]) => v !== null));
  return { priority: 'medium', listing_status: 'listed', outcome: 'sold', ...filled };
}

function openEditWatch(w) {
  openForm({
    title: 'Edit watch', submitLabel: 'Save changes', statusPicker: w.status === 'for_sale' ? 'owned' : w.status,
    groups: watchGroups(w.status === 'owned' || w.status === 'for_sale'),
    values: { ...withDefaults(w), list_for_sale: w.status === 'for_sale' },
    onSubmit: async (payload) => {
      await updateWatch(w.id, payload, 'Changes saved');
    },
  });
}

/* ---------- form dialog ---------- */
function fieldEl(f, values) {
  const id = 'f-' + f.name;
  const v = values[f.name];
  let input;
  if (f.type === 'select') {
    input = h('select', { id, name: f.name }, f.options.map(([val, label]) => h('option', { value: val }, label)));
    input.value = v ?? '';
    if (input.selectedIndex === -1) input.selectedIndex = 0;
  } else if (f.type === 'textarea') {
    input = h('textarea', { id, name: f.name, rows: 3, maxlength: 5000 });
    input.value = v ?? '';
  } else if (f.type === 'checkbox') {
    input = h('input', { id, name: f.name, type: 'checkbox' });
    input.checked = !!v;
  } else if (f.type === 'money') {
    input = h('input', { id, name: f.name, type: 'text', inputmode: 'decimal', placeholder: f.placeholder || '$0', autocomplete: 'off' });
    input.value = centsToDollars(v);
  } else if (f.type === 'number') {
    input = h('input', { id, name: f.name, type: 'text', inputmode: 'decimal', placeholder: f.placeholder || '', autocomplete: 'off' });
    input.value = v === null || v === undefined ? '' : String(v);
  } else {
    input = h('input', { id, name: f.name, type: f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text', placeholder: f.placeholder || '', autocomplete: 'off' });
    input.value = v ?? '';
  }
  if (f.required) input.required = true;
  if (f.type === 'checkbox') {
    return h('div', { class: 'field check', 'data-name': f.name }, input, h('label', { for: id }, f.label), h('div', { class: 'err' }));
  }
  return h('div', { class: 'field', 'data-name': f.name }, h('label', { for: id }, f.label), input, h('div', { class: 'err' }));
}

function layoutFields(fields, values) {
  const out = [];
  let pending = [];
  const flush = () => { if (pending.length) { out.push(h('div', { class: 'two' }, pending)); pending = []; } };
  for (const f of fields) {
    if (f.half) { pending.push(fieldEl(f, values)); if (pending.length === 2) flush(); }
    else { flush(); out.push(fieldEl(f, values)); }
  }
  flush();
  return out;
}

function readField(form, f) {
  const el = form.elements[f.name];
  if (f.type === 'checkbox') return el.checked;
  const raw = el.value.trim();
  if (f.type === 'money') {
    if (!raw) return null;
    const c = dollarsToCents(raw);
    if (Number.isNaN(c) || c < 0) throw Object.assign(new Error(`${f.label}: enter an amount like 1250 or 1,250.50`), { fields: { [f.name]: 'Enter an amount like 1250 or 1,250.50' } });
    return c;
  }
  if (f.type === 'number') {
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error(`${f.label}: enter a number`), { fields: { [f.name]: 'Enter a number' } });
    return n;
  }
  return raw;
}

function openForm({ title, groups, values = {}, submitLabel = 'Save', statusPicker = null, hint = null, onSubmit }) {
  const dlg = h('dialog', { class: 'dlg', 'aria-labelledby': 'dlg-title' });
  const errBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
  const body = h('div', { class: 'body' }, errBox);
  const form = h('form', {}, h('header', {}, h('h2', { id: 'dlg-title' }, title)), body);
  let status = statusPicker;

  if (statusPicker) {
    const radios = ['wishlist', 'owned', 'sold'].map((s) => {
      const c = sectionForStatus(s).color;
      return h('label', { style: `--c:${c}` },
        h('input', { type: 'radio', name: 'status', value: s, checked: s === status, onchange: () => { status = s; syncGroups(); } }),
        h('span', {}, s === 'sold' ? 'Past' : STATUS_LABEL[s]));
    });
    body.append(h('fieldset', { class: 'status-pick' }, h('legend', { class: 'sr-only', style: 'position:absolute;left:-9999px' }, 'Status'), radios));
  }

  const sets = groups.map((g) => {
    const fs = h('fieldset', {}, g.title ? h('legend', {}, g.title) : null, layoutFields(g.fields, values));
    fs._group = g;
    body.append(fs);
    return fs;
  });
  function syncGroups() {
    const ctx = { status, checked: (name) => !!form.elements[name]?.checked };
    for (const fs of sets) {
      const g = fs._group;
      fs.hidden = !!((status && g.showFor && !g.showFor.includes(status)) || (g.showWhen && !g.showWhen(ctx)));
    }
  }
  form.addEventListener('change', syncGroups);
  syncGroups();
  if (hint) body.append(h('p', { class: 'field hint' }, hint));

  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  form.append(h('footer', {}, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'), saveBtn));
  dlg.append(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;
    for (const el of form.querySelectorAll('.field .err')) el.textContent = '';
    saveBtn.disabled = true;
    try {
      const payload = {};
      for (const fs of sets) {
        if (fs.hidden) continue;
        for (const f of fs._group.fields) payload[f.name] = readField(form, f);
      }
      if (statusPicker) {
        payload.status = status === 'owned' && payload.list_for_sale ? 'for_sale' : status;
        delete payload.list_for_sale;
      }
      await onSubmit(payload);
      dlg.close();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
      for (const [name, msg] of Object.entries(err.fields || {})) {
        const slot = form.querySelector(`.field[data-name="${name}"] .err`);
        if (slot) slot.textContent = msg;
      }
      errBox.scrollIntoView({ block: 'nearest' });
    } finally {
      saveBtn.disabled = false;
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/* ---------- routing ---------- */
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const m = hash.match(/^watch\/(\d+)$/);
  if (m) return { name: 'detail', id: Number(m[1]) };
  if (hash === 'timeline') return { name: 'timeline' };
  if (SECTIONS[hash]) return { name: hash };
  return { name: 'owned' };
}

async function route() {
  const token = ++routeToken;
  const r = parseRoute();
  state.route = r;
  const main = $('#main');
  if (!state.loaded) {
    paintNav();
    main.replaceChildren(h('p', { class: 'loading' }, 'Loading your watches…'));
    try {
      await refresh();
      await loadEbayStatus();
    } catch (err) {
      if (token !== routeToken) return;
      main.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Could not load your watches'), h('p', {}, err.message),
        h('button', { class: 'btn primary', type: 'button', onclick: () => route() }, 'Try again')));
      return;
    }
    if (token !== routeToken) return;
  }
  if (r.name === 'detail') {
    state.detail = state.detail && state.detail.watch.id === r.id ? state.detail : null;
    paintNav();
    await showDetail(r.id, token);
    return;
  }
  state.detail = null;
  paintNav();
  if (r.name === 'timeline') { showTimeline(); window.scrollTo(0, 0); return; }
  showSection(r.name);
  window.scrollTo(0, 0);
}

// eBay sends you back here after you approve (or decline) the connection.
async function handleEbayReturn() {
  const p = new URLSearchParams(location.search);
  if (!p.has('ebay')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (p.get('ebay') === 'connected') {
    toast('eBay connected. Syncing your listings…');
    await loadEbayStatus();
    await syncEbayNow();
  } else {
    await loadEbayStatus();
    await rerender();
    toast(p.get('msg') || 'Could not connect to eBay.', true);
  }
}

renderShell();
window.addEventListener('hashchange', route);
route().then(handleEbayReturn);
