import { Hono } from 'hono';
import auth from './auth.js';
import products, { categories } from './products.js';
import voidRequests from './void-requests.js';
import adminUsers from './admin-users.js';
import dashboard from './dashboard.js';
import { requireAuth, requireAdmin } from './middleware.js';
import { cleanup } from './lib/cleanup.js';

const app = new Hono();

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM products').first();
  return c.json({ ok: true, products: row.n });
});

app.route('/api/auth', auth);
app.route('/api/products', products);
app.route('/api/categories', categories);
app.route('/api/void-requests', voidRequests);
app.route('/api/admin/users', adminUsers);
app.route('/api/admin/dashboard', dashboard);

// Manual trigger for the same cleanup the cron runs (admin only)
app.post('/api/admin/maintenance/cleanup', requireAuth, requireAdmin, async (c) => {
  return c.json(await cleanup(c.env.DB));
});

export default {
  fetch: app.fetch,

  // Runs on the cron schedule in wrangler.jsonc
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      cleanup(env.DB).then((r) => {
        console.log(
          `cleanup ok: ${r.sessions} expired sessions, ${r.login_attempts} old login attempts removed`
        );
      })
    );
  },
};