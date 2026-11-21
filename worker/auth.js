import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { verifyPassword, PBKDF2_ITERATIONS } from './lib/password.js';
import { newToken, sha256Hex, SESSION_COOKIE, SESSION_DAYS } from './lib/session.js';
import { requireAuth } from './middleware.js';

const auth = new Hono();
const MAX_FAILS = 5; // per email + IP, per 15 minutes

// Used when the email doesn't exist, so response time doesn't reveal valid emails
const DUMMY = {
  hash: btoa('\0'.repeat(32)),
  salt: btoa('\0'.repeat(16)),
  iterations: PBKDF2_ITERATIONS,
};

auth.post('/login', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid request' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password || email.length > 254 || password.length > 200) {
    return c.json({ error: 'Invalid email or password' }, 400);
  }

  const db = c.env.DB;
  const key = `${email}|${c.req.header('cf-connecting-ip') || 'local'}`;

  const attempt = await db
    .prepare(
      `SELECT count FROM login_attempts
        WHERE key = ?1 AND window_start > datetime('now', '-15 minutes')`
    )
    .bind(key)
    .first();
  if (attempt && attempt.count >= MAX_FAILS) {
    return c.json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);
  }

  const user = await db
    .prepare(
      `SELECT id, email, name, role, must_change_password,
              password_hash, password_salt, password_iterations
         FROM users WHERE email = ?1 AND is_active = 1`
    )
    .bind(email)
    .first();

  const ok = await verifyPassword(
    password,
    user
      ? { hash: user.password_hash, salt: user.password_salt, iterations: user.password_iterations }
      : DUMMY
  );

  if (!user || !ok) {
    await db
      .prepare(
        `INSERT INTO login_attempts (key, count, window_start)
         VALUES (?1, 1, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN window_start > datetime('now', '-15 minutes') THEN count + 1 ELSE 1 END,
           window_start = CASE WHEN window_start > datetime('now', '-15 minutes') THEN window_start ELSE datetime('now') END`
      )
      .bind(key)
      .run();
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  await db.prepare('DELETE FROM login_attempts WHERE key = ?1').bind(key).run();

  const token = newToken();
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES (?1, ?2, datetime('now', '+${SESSION_DAYS} days'))`
    )
    .bind(await sha256Hex(token), user.id)
    .run();

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      must_change_password: user.must_change_password,
    },
  });
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?1')
      .bind(await sha256Hex(token))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

auth.get('/me', requireAuth, (c) => c.json({ user: c.get('user') }));

export default auth;