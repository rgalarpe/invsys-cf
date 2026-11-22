// Units reserved by pending voids for the product id bound to ?2
const RESERVED = `(SELECT COALESCE(SUM(vr.quantity), 0) FROM void_requests vr
                    WHERE vr.product_id = ?2 AND vr.status = 'pending')`;

// Creates a pending request if enough unreserved units exist. Returns the new id, or null.
export async function insertVoidRequest(db, { productId, qty, reason, note, userId }) {
  const row = await db
    .prepare(
      `INSERT INTO void_requests (product_id, quantity, reason, note, requested_by)
       SELECT p.id, ?1, ?3, ?4, ?5
         FROM products p
        WHERE p.id = ?2 AND p.is_archived = 0
          AND p.quantity - ?1 >= ${RESERVED}
       RETURNING id`
    )
    .bind(qty, productId, reason, note, userId)
    .first();
  return row ? row.id : null;
}

// Approves ONE request: writes the void event, deducts stock, marks it approved.
// All three statements run in one transaction, and each re-checks that the request is still pending.
export async function approveRequest(db, requestId, adminId) {
  const vr = await db
    .prepare('SELECT id, product_id, quantity, status FROM void_requests WHERE id = ?')
    .bind(requestId)
    .first();
  if (!vr) return { ok: false, status: 404, error: 'Request not found' };
  if (vr.status !== 'pending') return { ok: false, status: 409, error: 'This request was already reviewed' };

  const [ins] = await db.batch([
    db
      .prepare(
        `INSERT INTO inventory_events (product_id, type, quantity, unit_price_cents, void_request_id, created_by)
         SELECT p.id, 'void', v.quantity, p.unit_price_cents, v.id, ?2
           FROM void_requests v JOIN products p ON p.id = v.product_id
          WHERE v.id = ?1 AND v.status = 'pending' AND p.quantity >= v.quantity`
      )
      .bind(requestId, adminId),
    db
      .prepare(
        `UPDATE products SET quantity = quantity - ?2, updated_at = datetime('now')
          WHERE id = ?3
            AND EXISTS (SELECT 1 FROM inventory_events e WHERE e.void_request_id = ?1 AND e.type = 'void')
            AND (SELECT status FROM void_requests WHERE id = ?1) = 'pending'`
      )
      .bind(requestId, vr.quantity, vr.product_id),
    db
      .prepare(
        `UPDATE void_requests
            SET status = 'approved', reviewed_by = ?2, reviewed_at = datetime('now')
          WHERE id = ?1 AND status = 'pending'
            AND EXISTS (SELECT 1 FROM inventory_events e WHERE e.void_request_id = ?1 AND e.type = 'void')`
      )
      .bind(requestId, adminId),
  ]);

  if (ins.meta.changes === 0) {
    return { ok: false, status: 409, error: 'Could not approve. It may already have been reviewed.' };
  }
  return { ok: true, productId: vr.product_id };
}