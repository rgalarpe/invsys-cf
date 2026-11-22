import { Hono } from 'hono';
import { requireAuth, requireAdmin } from './middleware.js';
import { hashPassword } from './lib/password.js';
import { checkPassword } from './lib/password-policy.js';

const users = new Hono();
users.use('*', requireAuth);
users.use('*', requireAdmin);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isUnique = (e) => /UNIQUE/i.test(String(e?.message));
const parseId = (s) => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ---------- list ----------
users.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.is_active, u.must_change_password, u.created_at,
            cb.name AS created_by_name
       FROM users u
       LEFT JOIN users cb ON cb.id = u.created_by
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT 200`
  ).all();
  return c.json({ items: results });
});

// ---------- create ----------
users.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: 'Invalid request' }, 400);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = body.role;

  if (name.length < 1 || name.length > 100) return c.json({ error: 'Name is required (max 100 characters)' }, 400);
  if (!EMAIL_RE.test(email) || email.length > 254) return c.json({ error: 'Enter a valid email' }, 400);
  if (!['admin', 'user'].includes(role)) return c.json({ error: 'Choose a role' }, 400);
  const problem = checkPassword(body.password, { email });
  if (problem) return c.json({ error: problem }, 400);

  const { hash, salt, iterations } = await hashPassword(body.password);

  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO users
         (email, name, role, password_hash, password_salt, password_iterations, must_change_password, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)
       RETURNING id, email, name, role, is_active, must_change_password, created_at`
    )
      .bind(email, name, role, hash, salt, iterations, c.get('user').id)
      .first();
    return c.json({ item: { ...row, created_by_name: c.get('user').name } }, 201);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: 'A user with that email already exists' }, 409);
    throw e;
  }
});

// ---------- deactivate / reactivate ----------
users.patch('/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid user' }, 400);
  const body = await c.req.json().catch(() => null);
  if (typeof body?.is_active !== 'boolean') return c.json({ error: 'Invalid request' }, 400);
  if (id === c.get('user').id) return c.json({ error: 'You cannot change your own account here' }, 400);

  const flag = body.is_active ? 1 : 0;
  const db = c.env.DB;
  const [upd] = await db.batch([
    db.prepare('UPDATE users SET is_active = ?1 WHERE id = ?2').bind(flag, id),
    // Deactivating signs the user out everywhere, immediately
    db.prepare('DELETE FROM sessions WHERE user_id = ?1 AND ?2 = 0').bind(id, flag),
  ]);
  if (upd.meta.changes === 0) return c.json({ error: 'User not found' }, 404);
  return c.json({ ok: true });
});

// ---------- reset password (sets a new temporary password) ----------
users.post('/:id/reset-password', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Invalid user' }, 400);
  if (id === c.get('user').id) {
    return c.json({ error: 'Use "Change password" for your own account' }, 400);
  }
  const body = await c.req.json().catch(() => null);

  const db = c.env.DB;
  const target = await db.prepare('SELECT email FROM users WHERE id = ?1').bind(id).first();
  if (!target) return c.json({ error: 'User not found' }, 404);

  const problem = checkPassword(body?.password, { email: target.email });
  if (problem) return c.json({ error: problem }, 400);

  const { hash, salt, iterations } = await hashPassword(body.password);
  await db.batch([
    db
      .prepare(
        `UPDATE users
            SET password_hash = ?1, password_salt = ?2, password_iterations = ?3, must_change_password = 1
          WHERE id = ?4`
      )
      .bind(hash, salt, iterations, id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id),
    // Also clears any login lockout for that email
    db
      .prepare("DELETE FROM login_attempts WHERE substr(key, 1, length(?1) + 1) = ?1 || '|'")
      .bind(target.email.toLowerCase()),
  ]);
  return c.json({ ok: true });
});

export default users;