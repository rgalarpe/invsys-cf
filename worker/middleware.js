import { getCookie } from 'hono/cookie';
import { sha256Hex, SESSION_COOKIE } from './lib/session.js';

export async function requireAuth(c, next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: 'Not signed in' }, 401);

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.must_change_password
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?1
        AND s.expires_at > datetime('now')
        AND u.is_active = 1`
  ).bind(await sha256Hex(token)).first();

  if (!user) return c.json({ error: 'Not signed in' }, 401);

  // A temporary password only lets you reach the auth routes (me, change-password)
  if (user.must_change_password && !c.req.path.startsWith('/api/auth/')) {
    return c.json(
      { error: 'You must change your password first', code: 'PASSWORD_CHANGE_REQUIRED' },
      403
    );
  }

  c.set('user', user);
  await next();
}

// Always use after requireAuth
export async function requireAdmin(c, next) {
  if (c.get('user')?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  await next();
}