import { Hono } from 'hono';
import auth from './auth.js';
import products, { categories } from './products.js';

const app = new Hono();

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM products').first();
  return c.json({ ok: true, products: row.n });
});

app.route('/api/auth', auth);
app.route('/api/products', products);
app.route('/api/categories', categories);

export default app;