import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware.js';
import { LOW_STOCK_THRESHOLD } from './lib/constants.js';
import { insertVoidRequest, approveRequest } from './lib/void.js';

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
            `SELECT p.id, p.name, p.category_id, c.name AS category, p.unit_price_cents, p.quantity,
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

// ---------- admin helpers ----------
const parseName = (v, max = 100) => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length >= 1 && s.length <= max ? s : null;
};
const validCents = (n) => Number.isInteger(n) && n >= 0 && n <= 100_000_000;
const validQty = (n, min) => Number.isInteger(n) && n >= min && n <= 1_000_000;
const isUnique = (e) => /UNIQUE/i.test(String(e?.message));
const cleanNote = (v) => (typeof v === 'string' ? v.trim().slice(0, 200) || null : null);

async function readJson(c) {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

// ---------- create item (admin) ----------
products.post('/', requireAdmin, async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'Invalid request' }, 400);

  const name = parseName(body.name);
  const categoryId = body.category_id;
  const cents = body.unit_price_cents;
  const qty = body.quantity ?? 0;

  if (!name) return c.json({ error: 'Name is required (max 100 characters)' }, 400);
  if (!Number.isInteger(categoryId)) return c.json({ error: 'Choose a category' }, 400);
  if (!validCents(cents)) return c.json({ error: 'Enter a valid price' }, 400);
  if (!validQty(qty, 0)) return c.json({ error: 'Initial quantity must be 0 or more' }, 400);

  const user = c.get('user');
  const db = c.env.DB;

  const cat = await db.prepare('SELECT 1 AS ok FROM categories WHERE id = ?').bind(categoryId).first();
  if (!cat) return c.json({ error: 'Category not found' }, 400);

  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO products (name, category_id, unit_price_cents, quantity)
           VALUES (?1, ?2, ?3, ?4)`
        )
        .bind(name, categoryId, cents, qty),
      db
        .prepare(
          `INSERT INTO inventory_events (product_id, type, quantity, unit_price_cents, created_by)
           SELECT id, 'create', ?2, unit_price_cents, ?3 FROM products WHERE name = ?1`
        )
        .bind(name, qty, user.id),
    ]);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: 'An item with that name already exists' }, 409);
    throw e;
  }

  const row = await db.prepare('SELECT id FROM products WHERE name = ?').bind(name).first();
  return c.json({ item: await getProduct(db, row.id) }, 201);
});

// ---------- edit name / category / price (admin) ----------
products.patch('/:id', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid item' }, 400);
  const body = await readJson(c);
  if (!body) return c.json({ error: 'Invalid request' }, 400);

  const db = c.env.DB;
  const user = c.get('user');
  if (!(await getProduct(db, id))) return c.json({ error: 'Item not found' }, 404);

  const sets = [];
  const params = [];
  let newPrice = null;

  if ('name' in body) {
    const name = parseName(body.name);
    if (!name) return c.json({ error: 'Name is required (max 100 characters)' }, 400);
    sets.push('name = ?');
    params.push(name);
  }
  if ('category_id' in body) {
    if (!Number.isInteger(body.category_id)) return c.json({ error: 'Choose a category' }, 400);
    const cat = await db.prepare('SELECT 1 AS ok FROM categories WHERE id = ?').bind(body.category_id).first();
    if (!cat) return c.json({ error: 'Category not found' }, 400);
    sets.push('category_id = ?');
    params.push(body.category_id);
  }
  if ('unit_price_cents' in body) {
    if (!validCents(body.unit_price_cents)) return c.json({ error: 'Enter a valid price' }, 400);
    newPrice = body.unit_price_cents;
    sets.push('unit_price_cents = ?');
    params.push(newPrice);
  }
  if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);

  const stmts = [];
  if (newPrice !== null) {
    // Runs BEFORE the update, so it records the old price. Skipped when the price didn't change.
    stmts.push(
      db
        .prepare(
          `INSERT INTO inventory_events
             (product_id, type, quantity, unit_price_cents, prev_unit_price_cents, created_by)
           SELECT p.id, 'price_update', 0, ?1, p.unit_price_cents, ?3
             FROM products p
            WHERE p.id = ?2 AND p.unit_price_cents <> ?1`
        )
        .bind(newPrice, id, user.id)
    );
  }
  stmts.push(
    db
      .prepare(
        `UPDATE products SET ${sets.join(', ')}, updated_at = datetime('now')
          WHERE id = ? AND is_archived = 0`
      )
      .bind(...params, id)
  );

  try {
    await db.batch(stmts);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: 'An item with that name already exists' }, 409);
    throw e;
  }

  return c.json({ item: await getProduct(db, id) });
});

// ---------- restock (admin) ----------
products.post('/:id/restock', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid item' }, 400);
  const body = await readJson(c);
  if (!body) return c.json({ error: 'Invalid request' }, 400);

  const qty = body.quantity;
  if (!validQty(qty, 1)) return c.json({ error: 'Quantity must be a whole number of at least 1' }, 400);
  const note = cleanNote(body.note);

  const user = c.get('user');
  const db = c.env.DB;

  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_events (product_id, type, quantity, unit_price_cents, note, created_by)
         SELECT p.id, 'restock', ?1, p.unit_price_cents, ?3, ?4
           FROM products p WHERE p.id = ?2 AND p.is_archived = 0`
      )
      .bind(qty, id, note, user.id),
    db
      .prepare(
        `UPDATE products SET quantity = quantity + ?1, updated_at = datetime('now')
          WHERE id = ?2 AND is_archived = 0`
      )
      .bind(qty, id),
  ]);

  if (ins.meta.changes === 0) return c.json({ error: 'Item not found' }, 404);
  return c.json({ item: await getProduct(db, id) });
});

// ---------- void request (anyone; an admin's void is approved immediately) ----------
products.post('/:id/void', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid item' }, 400);
  const body = await readJson(c);
  if (!body) return c.json({ error: 'Invalid request' }, 400);

  const qty = body.quantity;
  if (!validQty(qty, 1)) return c.json({ error: 'Quantity must be a whole number of at least 1' }, 400);
  if (!['damage', 'return'].includes(body.reason)) {
    return c.json({ error: 'Choose a reason: damage or return' }, 400);
  }
  const note = cleanNote(body.note);

  const user = c.get('user');
  const db = c.env.DB;

  const requestId = await insertVoidRequest(db, {
    productId: id, qty, reason: body.reason, note, userId: user.id,
  });

  if (!requestId) {
    const p = await getProduct(db, id);
    if (!p) return c.json({ error: 'Item not found' }, 404);
    const available = Math.max(0, p.quantity - p.pending_void_qty);
    return c.json({ error: `Only ${available} unit${available === 1 ? '' : 's'} available to void` }, 409);
  }

  let autoApproved = false;
  if (user.role === 'admin') {
    const res = await approveRequest(db, requestId, user.id);
    if (!res.ok) return c.json({ error: res.error }, res.status);
    autoApproved = true;
  }

  return c.json({ item: await getProduct(db, id), request_id: requestId, auto_approved: autoApproved }, 201);
});

// ---------- categories ----------
export const categories = new Hono();
categories.use('*', requireAuth);

categories.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM categories ORDER BY name COLLATE NOCASE'
  ).all();
  return c.json({ items: results });
});

categories.post('/', requireAdmin, async (c) => {
  const body = await readJson(c);
  const name = parseName(body?.name, 50);
  if (!name) return c.json({ error: 'Category name is required (max 50 characters)' }, 400);
  try {
    const row = await c.env.DB.prepare('INSERT INTO categories (name) VALUES (?) RETURNING id, name')
      .bind(name)
      .first();
    return c.json({ item: row }, 201);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: 'That category already exists' }, 409);
    throw e;
  }
});

export default products;