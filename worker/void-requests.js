import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware.js';
import { approveRequest } from './lib/void.js';

const voidRequests = new Hono();
voidRequests.use('*', requireAuth);
voidRequests.use('*', requireAdmin);

const parseId = (s) => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
};

voidRequests.post('/:id/approve', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid request' }, 400);
  const res = await approveRequest(c.env.DB, id, c.get('user').id);
  if (!res.ok) return c.json({ error: res.error }, res.status);
  return c.json({ ok: true, product_id: res.productId });
});

voidRequests.post('/:id/deny', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid request' }, 400);

  let body = null;
  try {
    body = await c.req.json();
  } catch {
    /* handled below */
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason || reason.length > 200) {
    return c.json({ error: 'A deny reason is required (max 200 characters)' }, 400);
  }

  const db = c.env.DB;
  const res = await db
    .prepare(
      `UPDATE void_requests
          SET status = 'denied', deny_reason = ?2, reviewed_by = ?3, reviewed_at = datetime('now')
        WHERE id = ?1 AND status = 'pending'`
    )
    .bind(id, reason, c.get('user').id)
    .run();

  if (res.meta.changes === 0) {
    const row = await db.prepare('SELECT status FROM void_requests WHERE id = ?').bind(id).first();
    if (!row) return c.json({ error: 'Request not found' }, 404);
    return c.json({ error: 'This request was already reviewed' }, 409);
  }
  return c.json({ ok: true });
});

export default voidRequests;