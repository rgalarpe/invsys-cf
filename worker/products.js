import { Hono } from 'hono';
import { requireAuth } from './middleware.js';
import { LOW_STOCK_THRESHOLD } from './lib/constants.js';

const PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 20;
const STATUSES = ['in', 'low', 'out', 'void'];
const HISTORY_TYPES = ['sold', 'restock', 'void', 'price_update', 'create'];

// Status is derived from quantity, never stored
const STATUS_SQL = `CASE
  WHEN p.quantity = 0 THEN 'out'
  WHEN p.quantity < ${LOW_STOCK_THRESHOLD} THEN 'low'
  ELSE 'in' END`;

const STATUS_WHERE = {
  in: `p.quantity >= ${LOW_STOCK_THRESHOLD}`,
  low: `p.quantity > 0 AND p.quantity < ${LOW_STOCK_THRESHOLD}`,
  out: 'p.quantity = 0',
  void: `EXISTS (SELECT 1 FROM void_requests v
                  WHERE v.product_id = p.id AND v.status IN ('pending','approved'))`,
};

// Units reserved by pending void requests (for selects, alias p)
const PENDING_VOID_SQL = `COALESCE((SELECT SUM(v.quantity) FROM void_requests v
                                     WHERE v.product_id = p.id AND v.status = 'pending'), 0)`;

// Same thing for write statements, where the product id is parameter ?2
const RESERVED_BY_ID = `(SELECT COALESCE(SUM(vr.quantity), 0) FROM void_requests vr
                          WHERE vr.product_id = ?2 AND vr.status = 'pending')`;

// ---------- small helpers ----------
const parseId = (s) => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const mondayOf = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d);
};
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && iso(new Date(`${s}T00:00:00Z`)) === s;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

async function getProduct(db, id) {
  return db
    .prepare(
      `SELECT p.id, p.name, c.name AS category, p.unit_price_cents, p.quantity,
              p.updated_at, ${STATUS_SQL} AS status, ${PENDING_VOID_SQL} AS pending_void_qty
         FROM products p
         JOIN categories c ON c.id = p.category_id
        WHERE p.id = ? AND p.is_archived = 0`
    )
    .bind(id)
    .first();
}

const products = new Hono();
products.use('*', requireAuth);

// ---------- list ----------
products.get('/', async (c) => {
  const q = (c.req.query('q') || '').trim().slice(0, 100);
  const status = c.req.query('status') || 'all';
  const categoryRaw = c.req.query('category');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);

  if (status !== 'all' && !STATUSES.includes(status)) {
    return c.json({ error: 'Invalid status' }, 400);
  }

  const where = ['p.is_archived = 0'];
  const params = [];

  if (q) {
    where.push("p.name LIKE ? ESCAPE '\\'");
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (status !== 'all') where.push(`(${STATUS_WHERE[status]})`);
  if (categoryRaw) {
    const categoryId = parseInt(categoryRaw, 10);
    if (!Number.isInteger(categoryId)) return c.json({ error: 'Invalid category' }, 400);
    where.push('p.category_id = ?');
    params.push(categoryId);
  }

  const whereSql = where.join(' AND ');
  const db = c.env.DB;

  const [countRes, listRes] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE ${whereSql}`).bind(...params),
    db
      .prepare(
        `SELECT p.id, p.name, c.name AS category, p.unit_price_cents, p.quantity,
                p.updated_at, ${STATUS_SQL} AS status, ${PENDING_VOID_SQL} AS pending_void_qty
           FROM products p
           JOIN categories c ON c.id = p.category_id
          WHERE ${whereSql}
          ORDER BY p.name COLLATE NOCASE
          LIMIT ? OFFSET ?`
      )
      .bind(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE),
  ]);

  return c.json({
    items: listRes.results,
    total: countRes.results[0].n,
    page,
    pageSize: PAGE_SIZE,
  });
});

// ---------- one item ----------
products.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid item' }, 400);
  const item = await getProduct(c.env.DB, id);
  if (!item) return c.json({ error: 'Item not found' }, 404);
  return c.json({ item });
});

// ---------- consumption (sold units per day or week) ----------
products.get('/:id/consumption', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid item' }, 400);

  const bucket = c.req.query('bucket') === 'week' ? 'week' : 'day';
  const to = c.req.query('to') || iso(new Date());
  const from = c.req.query('from') || addDays(to, -59);

  if (!validDate(from) || !validDate(to) || from > to) {
    return c.json({ error: 'Invalid date range' }, 400);
  }
  if (daysBetween(from, to) > 366) return c.json({ error: 'Range too large' }, 400);

  const db = c.env.DB;
  const exists = await db.prepare('SELECT 1 AS ok FROM products WHERE id = ? AND is_archived = 0').bind(id).first();
  if (!exists) return c.json({ error: 'Item not found' }, 404);

  const start = bucket === 'week' ? mondayOf(from) : from;
  const bucketSql = bucket === 'week' ? "date(created_at, 'weekday 0', '-6 days')" : 'date(created_at)';

  const { results } = await db
    .prepare(
      `SELECT ${bucketSql} AS bucket, SUM(quantity) AS qty
         FROM inventory_events
        WHERE product_id = ?1 AND type = 'sold'
          AND created_at >= ?2 AND created_at < date(?3, '+1 day')
        GROUP BY bucket`
    )
    .bind(id, start, to)
    .all();

  const byBucket = new Map(results.map((r) => [r.bucket, r.qty]));
  const series = [];
  const step = bucket === 'week' ? 7 : 1;
  for (let d = start; d <= to; d = addDays(d, step)) {
    series.push({ date: d, qty: byBucket.get(d) || 0 });
  }

  return c.json({
    bucket,
    from: start,
    to,
    series,
    total: series.reduce((sum, p) => sum + p.qty, 0),
  });
});

// ---------- history (events + void requests) ----------
products.get('/:id/history', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid item' }, 400);

  const type = c.req.query('type') || 'all';
  if (type !== 'all' && !HISTORY_TYPES.includes(type)) return c.json({ error: 'Invalid type' }, 400);
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);

  const db = c.env.DB;
  const exists = await db.prepare('SELECT 1 AS ok FROM products WHERE id = ? AND is_archived = 0').bind(id).first();
  if (!exists) return c.json({ error: 'Item not found' }, 404);

  // Void events are represented by their request row, so exclude them here to avoid duplicates
  const inner = `
    SELECT e.id AS id, 'event' AS src, e.type AS type, e.quantity AS quantity,
           e.unit_price_cents AS unit_price_cents, e.prev_unit_price_cents AS prev_unit_price_cents,
           e.note AS note, NULL AS void_status, NULL AS reason, NULL AS deny_reason,
           u.name AS by_name, e.created_at AS happened_at
      FROM inventory_events e JOIN users u ON u.id = e.created_by
     WHERE e.product_id = ? AND e.type <> 'void'
    UNION ALL
    SELECT v.id, 'void', 'void', v.quantity, NULL, NULL,
           v.note, v.status, v.reason, v.deny_reason,
           u.name, v.requested_at
      FROM void_requests v JOIN users u ON u.id = v.requested_by
     WHERE v.product_id = ?`;

  const typeSql = type === 'all' ? '' : 'WHERE h.type = ?';
  const base = type === 'all' ? [id, id] : [id, id, type];

  const [countRes, listRes] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM (${inner}) h ${typeSql}`).bind(...base),
    db
      .prepare(
        `SELECT * FROM (${inner}) h ${typeSql}
          ORDER BY h.happened_at DESC, h.src, h.id DESC
          LIMIT ? OFFSET ?`
      )
      .bind(...base, HISTORY_PAGE_SIZE, (page - 1) * HISTORY_PAGE_SIZE),
  ]);

  return c.json({
    items: listRes.results,
    total: countRes.results[0].n,
    page,
    pageSize: HISTORY_PAGE_SIZE,
  });
});

// ---------- mark sold ----------
products.post('/:id/sold', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid item' }, 400);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request' }, 400);
  }

  const qty = body.quantity;
  if (!Number.isInteger(qty) || qty < 1 || qty > 1_000_000) {
    return c.json({ error: 'Quantity must be a whole number of at least 1' }, 400);
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) || null : null;

  const user = c.get('user');
  const db = c.env.DB;

  // Both statements share the same guard and run in one transaction: both apply or neither does.
  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_events (product_id, type, quantity, unit_price_cents, note, created_by)
         SELECT p.id, 'sold', ?1, p.unit_price_cents, ?3, ?4
           FROM products p
          WHERE p.id = ?2 AND p.is_archived = 0
            AND p.quantity - ?1 >= ${RESERVED_BY_ID}`
      )
      .bind(qty, id, note, user.id),
    db
      .prepare(
        `UPDATE products
            SET quantity = quantity - ?1, updated_at = datetime('now')
          WHERE id = ?2 AND is_archived = 0
            AND quantity - ?1 >= ${RESERVED_BY_ID}`
      )
      .bind(qty, id),
  ]);

  if (ins.meta.changes === 0) {
    const p = await getProduct(db, id);
    if (!p) return c.json({ error: 'Item not found' }, 404);
    const available = Math.max(0, p.quantity - p.pending_void_qty);
    return c.json({ error: `Only ${available} unit${available === 1 ? '' : 's'} available to sell` }, 409);
  }

  return c.json({ item: await getProduct(db, id) });
});

export const categories = new Hono();
categories.use('*', requireAuth);
categories.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM categories ORDER BY name COLLATE NOCASE'
  ).all();
  return c.json({ items: results });
});

export default products;