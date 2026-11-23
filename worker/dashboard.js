import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware.js';
import { LOW_STOCK_THRESHOLD } from './lib/constants.js';

const ACTION_LIMIT = 50;
const T = LOW_STOCK_THRESHOLD; // a code constant, safe to put in SQL

const dashboard = new Hono();
dashboard.use('*', requireAuth);
dashboard.use('*', requireAdmin);

dashboard.get('/', async (c) => {
  const db = c.env.DB;

  const [totals, cats, voids, outs, lows] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS items,
              COALESCE(SUM(quantity), 0) AS units,
              COALESCE(SUM(quantity * unit_price_cents), 0) AS value_cents,
              COALESCE(SUM(CASE WHEN quantity > 0 AND quantity < ${T} THEN 1 ELSE 0 END), 0) AS low_count,
              COALESCE(SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END), 0) AS out_count,
              (SELECT COUNT(*) FROM void_requests WHERE status = 'pending') AS pending_void_count
         FROM products
        WHERE is_archived = 0`
    ),
    db.prepare(
      `SELECT c.id, c.name AS category,
              COUNT(p.id) AS items,
              COALESCE(SUM(p.quantity), 0) AS units,
              COALESCE(SUM(p.quantity * p.unit_price_cents), 0) AS value_cents
         FROM categories c
         JOIN products p ON p.category_id = c.id AND p.is_archived = 0
        GROUP BY c.id
        ORDER BY c.name COLLATE NOCASE`
    ),
    db
      .prepare(
        `SELECT v.id, v.product_id, p.name AS product_name, v.quantity, v.reason, v.note,
                u.name AS by_name, v.requested_at
           FROM void_requests v
           JOIN products p ON p.id = v.product_id
           JOIN users u ON u.id = v.requested_by
          WHERE v.status = 'pending'
          ORDER BY v.requested_at ASC, v.id ASC
          LIMIT ?`
      )
      .bind(ACTION_LIMIT),
    db
      .prepare(
        `SELECT p.id, p.name, c.name AS category, p.updated_at
           FROM products p
           JOIN categories c ON c.id = p.category_id
          WHERE p.is_archived = 0 AND p.quantity = 0
          ORDER BY p.updated_at DESC, p.name COLLATE NOCASE
          LIMIT ?`
      )
      .bind(ACTION_LIMIT),
    db
      .prepare(
        `SELECT p.id, p.name, c.name AS category, p.quantity, p.updated_at
           FROM products p
           JOIN categories c ON c.id = p.category_id
          WHERE p.is_archived = 0 AND p.quantity > 0 AND p.quantity < ${T}
          ORDER BY p.quantity ASC, p.name COLLATE NOCASE
          LIMIT ?`
      )
      .bind(ACTION_LIMIT),
  ]);

  return c.json({
    totals: totals.results[0],
    by_category: cats.results,
    pending_voids: voids.results,
    out_of_stock: outs.results,
    low_stock: lows.results,
    low_threshold: T,
  });
});

export default dashboard;