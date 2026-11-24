// Generates ~60 days of realistic mock inventory data as SQL.
//
// Usage:  node scripts/generate-mock.mjs > db/mock-seed.local.sql
//
// WARNING: the generated SQL first DELETES all products, categories, inventory
// events and void requests in the target database. Users are never touched.
//
// Every stock change goes through the same ledger the app uses, so
//   products.quantity = Σ(create + restock) − Σ(sold) − Σ(approved void)
// holds for every product.

const SEED = 'inventory-demo-v1';
const DAYS = 60;
const MAX_ATTEMPTS = 2000;

// ---------- deterministic randomness ----------
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---------- time helpers (all UTC) ----------
const nowMs = Date.now();
const nowDate = new Date(nowMs);
const todayMs = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
const DAY_MS = 86400000;
const at = (dayOffset, minutes) => todayMs + dayOffset * DAY_MS + minutes * 60000;
const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const weekdayOf = (dayOffset) => new Date(todayMs + dayOffset * DAY_MS).getUTCDay();
// Sun..Sat: busier on Friday and Saturday
const WEEKDAY = [0.7, 0.9, 1.0, 1.05, 1.1, 1.4, 1.6];

// ---------- catalog ----------
const CATEGORIES = ['Beverages', 'Snacks', 'Household', 'Personal Care', 'Office Supplies'];

// avg = units per day; start = opening stock; reorder/restock = restock policy;
// target = final status; stop = [min,max] days ago after which restocking stops
// voids: [dayOffset, qty, reason, status, denyReason?]
// pending: { q, hoursAgo }
const P = [
  { name: 'Bottled Water 500ml', cat: 0, price: 90, avg: 16, start: 420, reorder: 130, restock: 320, target: 'in',
    voids: [[-38, 6, 'damage', 'approved']], pending: { q: 4, hoursAgo: 20 } },
  { name: 'Orange Juice 1L', cat: 0, price: 450, avg: 5, start: 160, reorder: 70, restock: 140, target: 'in',
    voids: [[-26, 3, 'damage', 'denied', 'Photo evidence missing']] },
  { name: 'Ground Coffee 250g', cat: 0, price: 1250, avg: 4, start: 120, reorder: 60, restock: 120, target: 'low',
    stop: [12, 30], newPrice: 1350 },
  { name: 'Green Tea (25 bags)', cat: 0, price: 520, avg: 2.5, start: 100, reorder: 45, restock: 90, target: 'in' },
  { name: 'Energy Drink 330ml', cat: 0, price: 220, avg: 9, start: 260, reorder: 90, restock: 200, target: 'out',
    stop: [18, 38] },

  { name: 'Potato Chips Family Pack', cat: 1, price: 380, avg: 11, start: 300, reorder: 110, restock: 240, target: 'in',
    voids: [[-17, 4, 'return', 'approved']] },
  { name: 'Salted Peanuts 200g', cat: 1, price: 310, avg: 4, start: 120, reorder: 55, restock: 110, target: 'in' },
  { name: 'Chocolate Bar 50g', cat: 1, price: 140, avg: 12, start: 320, reorder: 100, restock: 260, target: 'low',
    stop: [10, 24], newPrice: 150 },
  { name: 'Instant Noodles Cup', cat: 1, price: 120, avg: 14, start: 380, reorder: 120, restock: 300, target: 'in',
    voids: [[-9, 5, 'damage', 'approved']], pending: { q: 3, hoursAgo: 9 } },
  { name: 'Crackers 300g', cat: 1, price: 260, avg: 3, start: 90, reorder: 50, restock: 100, target: 'out',
    stop: [20, 40] },

  { name: 'Dish Soap 1L', cat: 2, price: 590, avg: 3.5, start: 110, reorder: 50, restock: 100, target: 'in',
    voids: [[-31, 2, 'damage', 'approved']] },
  { name: 'Laundry Detergent 2kg', cat: 2, price: 1490, avg: 3, start: 90, reorder: 45, restock: 90, target: 'low',
    stop: [12, 28], newPrice: 1590, voids: [[-14, 2, 'return', 'denied', 'Item not eligible for return']] },
  { name: 'Paper Towels 6-pack', cat: 2, price: 980, avg: 5, start: 150, reorder: 65, restock: 130, target: 'in',
    pending: { q: 2, hoursAgo: 33 } },
  { name: 'Trash Bags 30ct', cat: 2, price: 410, avg: 4, start: 120, reorder: 55, restock: 110, target: 'in',
    voids: [[-45, 3, 'damage', 'approved']] },
  { name: 'Sponge Pack 3ct', cat: 2, price: 250, avg: 2.5, start: 80, reorder: 45, restock: 90, target: 'low',
    stop: [15, 35] },

  { name: 'Shampoo 400ml', cat: 3, price: 850, avg: 3.5, start: 110, reorder: 55, restock: 110, target: 'in',
    voids: [[-24, 2, 'return', 'approved']], newPrice: 890 },
  { name: 'Toothpaste 120g', cat: 3, price: 340, avg: 6, start: 180, reorder: 75, restock: 150, target: 'in',
    voids: [[-6, 2, 'damage', 'denied', 'Quantity exceeds damaged units found']] },
  { name: 'Bath Soap 3-pack', cat: 3, price: 290, avg: 4.5, start: 140, reorder: 60, restock: 120, target: 'low',
    stop: [8, 22] },
  { name: 'Hand Sanitizer 250ml', cat: 3, price: 460, avg: 5, start: 150, reorder: 65, restock: 130, target: 'out',
    stop: [15, 32] },

  { name: 'Ballpoint Pens 12ct', cat: 4, price: 380, avg: 2.5, start: 90, reorder: 45, restock: 90, target: 'in',
    voids: [[-12, 2, 'damage', 'approved']], pending: { q: 2, hoursAgo: 52 } },
  { name: 'A4 Copy Paper 500 sheets', cat: 4, price: 650, avg: 4, start: 130, reorder: 60, restock: 120, target: 'in',
    newPrice: 690, voids: [[-33, 4, 'return', 'denied', 'Duplicate request']] },
  { name: 'Sticky Notes 6-pad', cat: 4, price: 360, avg: 2, start: 70, reorder: 40, restock: 80, target: 'in',
    voids: [[-28, 1, 'damage', 'approved']] },
];

const RESTOCK_NOTES = ['Supplier delivery', 'Weekly restock', 'Replenishment order'];
const NOTES = { damage: ['Damaged in storage', 'Packaging torn', null], return: ['Customer return', 'Wrong item delivered', null] };

// Users are looked up in SQL so the same file works on local and remote databases.
// Hidden accounts are never used as the visible author.
const ADMIN = `COALESCE((SELECT MIN(id) FROM users WHERE role = 'admin' AND is_hidden = 0 AND is_active = 1), (SELECT MIN(id) FROM users WHERE role = 'admin'))`;
const STAFF = `COALESCE((SELECT MIN(id) FROM users WHERE role = 'user' AND is_active = 1), ${ADMIN})`;

// ---------- simulation ----------
function simulate(p, idx, attempt) {
  const rng = mulberry32(hashStr(`${SEED}|${p.name}|${attempt}`));
  const slope = -0.1 + rng() * 0.35; // gentle demand trend across the period
  const stopAgo = p.stop ? p.stop[0] + Math.floor(rng() * (p.stop[1] - p.stop[0] + 1)) : null;
  const stopDay = stopAgo === null ? Infinity : -stopAgo;
  const priceDay = p.newPrice ? -(8 + Math.floor(rng() * 32)) : null;

  const events = [];
  const reqs = [];
  const soldDays = new Set();
  let stock = p.start;
  let price = p.price;
  let droppedVoids = 0;

  const createMs = at(-62 - (idx % 4), 30 + idx * 2);
  events.push({ type: 'create', qty: p.start, price, ts: createMs, by: 'admin' });
  let lastMs = createMs;
  const bump = (ms) => { if (ms > lastMs) lastMs = ms; };

  for (let d = -DAYS + 1; d <= 0; d++) {
    if (priceDay === d) {
      const ts = at(d, 10 + Math.floor(rng() * 40));
      events.push({ type: 'price_update', qty: 0, price: p.newPrice, prev: price, ts, by: 'admin' });
      price = p.newPrice;
      bump(ts);
    }

    if (d <= stopDay && stock <= p.reorder) {
      const qty = Math.round(p.restock * (0.9 + rng() * 0.2));
      const ts = at(d, 60 + Math.floor(rng() * 60));
      events.push({ type: 'restock', qty, price, ts, note: pick(rng, RESTOCK_NOTES), by: 'admin' });
      stock += qty;
      bump(ts);
    }

    const trend = 1 + slope * ((d + DAYS - 1) / (DAYS - 1));
    const demand = poisson(rng, p.avg * WEEKDAY[weekdayOf(d)] * trend);
    const total = Math.min(demand, stock);
    if (total > 0) {
      let qtys = [total];
      if (total >= 3 && rng() < 0.5) {
        const first = 1 + Math.floor(rng() * (total - 1));
        qtys = [first, total - first];
      }
      const mins = qtys.map(() => 120 + Math.floor(rng() * 600)).sort((a, b) => a - b); // 02:00-11:59
      for (let i = 0; i < qtys.length; i++) {
        const ts = at(d, mins[i]);
        if (ts > nowMs) continue; // never create events in the future
        events.push({
          type: 'sold', qty: qtys[i], price, ts,
          note: rng() < 0.08 ? 'Bulk order' : null,
          by: rng() < 0.85 ? 'staff' : 'admin',
        });
        stock -= qtys[i];
        soldDays.add(d);
        bump(ts);
      }
    }

    for (const [vd, vq, reason, status, denyReason] of p.voids || []) {
      if (vd !== d) continue;
      const reviewedMs = at(d, 720 + Math.floor(rng() * 240)); // 12:00-15:59
      const requestedMs = reviewedMs - (60 + Math.floor(rng() * 17 * 60)) * 60000;
      const note = pick(rng, NOTES[reason]);
      if (status === 'approved') {
        if (stock < vq) { droppedVoids++; continue; }
        const req = { productIdx: idx, qty: vq, reason, note, status, denyReason: null, requestedMs, reviewedMs };
        reqs.push(req);
        events.push({ type: 'void', qty: vq, price, ts: reviewedMs, req, by: 'admin' });
        stock -= vq;
        bump(reviewedMs);
      } else {
        reqs.push({ productIdx: idx, qty: vq, reason, note, status, denyReason, requestedMs, reviewedMs });
      }
    }
  }

  if (p.pending) {
    const requestedMs = Math.min(nowMs - 5 * 60000, nowMs - p.pending.hoursAgo * 3600000);
    reqs.push({
      productIdx: idx, qty: p.pending.q, reason: p.pending.q % 2 ? 'damage' : 'return',
      note: pick(rng, NOTES.damage), status: 'pending', denyReason: null, requestedMs, reviewedMs: null,
    });
  }

  return { events, reqs, stock, price, soldDays, createMs, lastMs, droppedVoids };
}

function accept(p, r) {
  if (r.droppedVoids > 0) return false;
  if (r.soldDays.size < 20) return false;
  if (p.pending && r.stock < p.pending.q + 3) return false;
  if (p.target === 'in') return r.stock >= 55;
  if (p.target === 'low') return r.stock >= 6 && r.stock <= 45;
  return r.stock === 0;
}

const results = P.map((p, idx) => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const r = simulate(p, idx, attempt);
    if (accept(p, r)) return r;
  }
  throw new Error(`Could not satisfy the target "${p.target}" for ${p.name}`);
});

// ---------- assign ids in chronological order ----------
const allReqs = results.flatMap((r) => r.reqs).sort((a, b) => a.requestedMs - b.requestedMs || a.productIdx - b.productIdx);
allReqs.forEach((q, i) => { q.id = i + 1; });

const allEvents = results
  .flatMap((r, idx) => r.events.map((e) => ({ ...e, productIdx: idx })))
  .sort((a, b) => a.ts - b.ts || a.productIdx - b.productIdx);
allEvents.forEach((e, i) => { e.id = i + 1; });

// ---------- SQL output ----------
const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);
const by = (who) => (who === 'staff' ? STAFF : ADMIN);

function insert(table, cols, rows, size = 50) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(`INSERT INTO ${table} (${cols}) VALUES\n${rows.slice(i, i + size).join(',\n')};`);
  }
  return out.join('\n');
}

const sql = [];
sql.push('-- Mock data. Generated by scripts/generate-mock.mjs. Do not edit by hand.');
sql.push('DELETE FROM inventory_events;');
sql.push('DELETE FROM void_requests;');
sql.push('DELETE FROM products;');
sql.push('DELETE FROM categories;');

sql.push(insert('categories', 'id, name', CATEGORIES.map((n, i) => `(${i + 1}, ${q(n)})`)));

sql.push(
  insert(
    'products',
    'id, name, category_id, unit_price_cents, quantity, is_archived, created_at, updated_at',
    P.map((p, i) => `(${i + 1}, ${q(p.name)}, ${p.cat + 1}, ${results[i].price}, ${results[i].stock}, 0, ${q(fmt(results[i].createMs))}, ${q(fmt(results[i].lastMs))})`)
  )
);

sql.push(
  insert(
    'void_requests',
    'id, product_id, quantity, reason, note, status, deny_reason, requested_by, requested_at, reviewed_by, reviewed_at',
    allReqs.map(
      (r) =>
        `(${r.id}, ${r.productIdx + 1}, ${r.qty}, ${q(r.reason)}, ${q(r.note)}, ${q(r.status)}, ${q(r.denyReason)}, ${STAFF}, ${q(fmt(r.requestedMs))}, ${r.reviewedMs ? ADMIN : 'NULL'}, ${r.reviewedMs ? q(fmt(r.reviewedMs)) : 'NULL'})`
    )
  )
);

sql.push(
  insert(
    'inventory_events',
    'id, product_id, type, quantity, unit_price_cents, prev_unit_price_cents, void_request_id, note, created_by, created_at',
    allEvents.map(
      (e) =>
        `(${e.id}, ${e.productIdx + 1}, ${q(e.type)}, ${e.qty}, ${e.price}, ${e.prev ?? 'NULL'}, ${e.req ? e.req.id : 'NULL'}, ${q(e.note ?? null)}, ${by(e.by)}, ${q(fmt(e.ts))})`
    )
  )
);

console.log(sql.join('\n\n'));

// ---------- summary (stderr, so it doesn't pollute the SQL file) ----------
const count = (t) => allEvents.filter((e) => e.type === t).length;
const finals = results.map((r) => r.stock);
console.error(
  [
    `products: ${P.length}`,
    `events: ${allEvents.length} (sold ${count('sold')}, restock ${count('restock')}, void ${count('void')}, price ${count('price_update')}, create ${count('create')})`,
    `void requests: ${allReqs.length} (pending ${allReqs.filter((r) => r.status === 'pending').length}, approved ${allReqs.filter((r) => r.status === 'approved').length}, denied ${allReqs.filter((r) => r.status === 'denied').length})`,
    `final status: ${finals.filter((s) => s >= 50).length} in stock, ${finals.filter((s) => s > 0 && s < 50).length} low, ${finals.filter((s) => s === 0).length} out`,
  ].join('\n')
);