import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { CURRENCY, money, shortDateTime } from '../format.js';
import DenyModal from '../components/DenyModal.jsx';
import RestockModal from '../components/RestockModal.jsx';

// Chart colors (same values as --accent-tint, --accent, --divider, --text-muted in styles.css)
const TINT = '#C7CBFA';
const ACCENT = '#4F46E5';
const GRID = '#EEF0F4';
const AXIS = '#5B6475';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const compactMoney = (cents) => `${CURRENCY}${compact.format(cents / 100)}`;
const truncate = (s) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);

function StockChart({ rows, totals }) {
  const [metric, setMetric] = useState('units');
  const key = metric === 'units' ? 'units' : 'value_cents';
  const max = Math.max(0, ...rows.map((r) => r[key]));
  const peak = max > 0 ? rows.findIndex((r) => r[key] === max) : -1;

  return (
    <div className="card span-2">
      <div className="card-head" style={{ padding: 0, marginBottom: 12, alignItems: 'flex-start' }}>
        <div>
          <div className="stat-label">Total stock value</div>
          <div className="stat-value">{money(totals.value_cents)}</div>
          <p className="muted stat-note">
            {totals.units.toLocaleString()} units across {totals.items.toLocaleString()} item
            {totals.items === 1 ? '' : 's'}
          </p>
        </div>
        <div className="pills">
          {[
            { k: 'units', label: 'Units' },
            { k: 'value', label: 'Value' },
          ].map((m) => (
            <button
              key={m.k}
              className={`pill ${metric === m.k ? 'active' : ''}`}
              aria-pressed={metric === m.k}
              onClick={() => setMetric(m.k)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No items yet. Add some on the Inventory page.</div>
      ) : (
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="category"
                interval={0}
                tickFormatter={truncate}
                tick={{ fill: AXIS, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                width={56}
                allowDecimals={false}
                tickFormatter={metric === 'units' ? (v) => compact.format(v) : compactMoney}
                tick={{ fill: AXIS, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: '#F5F6F9' }}
                formatter={(v) =>
                  metric === 'units'
                    ? [Number(v).toLocaleString(), 'Units in stock']
                    : [money(Number(v)), 'Stock value']
                }
                contentStyle={{ borderRadius: 12, border: '1px solid #E6E8EE', boxShadow: 'none' }}
              />
              <Bar dataKey={key} radius={[6, 6, 0, 0]} maxBarSize={56}>
                {rows.map((_, i) => (
                  <Cell key={i} fill={i === peak ? ACCENT : TINT} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const [denying, setDenying] = useState(null);
  const [restocking, setRestocking] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api('/admin/dashboard');
      setData(d);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function approve(v) {
    setActionError('');
    setBusyKey(`void-${v.id}`);
    try {
      await api(`/void-requests/${v.id}/approve`, { method: 'POST' });
    } catch (e) {
      setActionError(e.message);
    }
    await load(); // refresh even after an error so the screen shows the real state
    setBusyKey(null);
  }

  async function confirmDeny(reason) {
    await api(`/void-requests/${denying.id}/deny`, { method: 'POST', body: { reason } });
    await load();
  }

  if (!data) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="muted">Stock overview</p>
          </div>
        </div>
        {error ? <div className="alert-danger" role="alert">{error}</div> : <div className="muted">Loading…</div>}
      </>
    );
  }

  const { totals, by_category, pending_voids, out_of_stock, low_stock, low_threshold } = data;
  const actionCount = totals.pending_void_count + totals.out_count + totals.low_count;
  const shown = pending_voids.length + out_of_stock.length + low_stock.length;
  const truncated =
    totals.pending_void_count > pending_voids.length ||
    totals.out_count > out_of_stock.length ||
    totals.low_count > low_stock.length;
  const lowPct = totals.items > 0 ? Math.min(100, (totals.low_count / totals.items) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="muted">Stock overview</p>
        </div>
      </div>

      {error && <div className="alert-danger" role="alert">{error}</div>}

      <div className="bento">
        <StockChart rows={by_category} totals={totals} />

        <Link to="/inventory?status=low" className="card card-link">
          <div className="stat-label">Low stock items</div>
          <div className="stat-value">{totals.low_count.toLocaleString()}</div>
          <p className="stat-note warn">
            {totals.low_count} of {totals.items} items below {low_threshold}
          </p>
          <div className="progress"><div style={{ width: `${lowPct}%` }} /></div>
        </Link>

        <Link to="/inventory?status=out" className="card card-link">
          <div className="stat-label">Out of stock</div>
          <div className="stat-value">{totals.out_count.toLocaleString()}</div>
          <p className={`stat-note ${totals.out_count > 0 ? 'danger' : 'muted'}`}>
            {totals.out_count > 0 ? 'Need a restock' : 'Nothing out of stock'}
          </p>
        </Link>

        <div className="card flush span-4">
          <div className="card-head">
            <div>
              <h2 className="section-title">Action needed</h2>
              <p className="muted">
                {actionCount === 0
                  ? 'Nothing needs your attention.'
                  : `${actionCount} item${actionCount === 1 ? '' : 's'} waiting${truncated ? ` · showing the first ${shown}` : ''}`}
              </p>
            </div>
          </div>

          {actionError && (
            <div className="alert-danger" style={{ margin: '0 22px 16px' }} role="alert">{actionError}</div>
          )}

          {actionCount === 0 ? (
            <div className="empty">You're all caught up.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Item</th>
                    <th>Details</th>
                    <th>Since</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pending_voids.map((v) => (
                    <tr key={`void-${v.id}`}>
                      <td><span className="chip chip-warning">Void request</span></td>
                      <td>
                        <div className="cell-title">
                          <Link className="row-link" to={`/inventory/${v.product_id}`}>{v.product_name}</Link>
                        </div>
                      </td>
                      <td className="muted">
                        {v.quantity.toLocaleString()} unit{v.quantity === 1 ? '' : 's'} ·{' '}
                        {v.reason === 'damage' ? 'Damage' : 'Return'} · {v.by_name}
                        {v.note ? ` · ${v.note}` : ''}
                      </td>
                      <td className="muted">{shortDateTime(v.requested_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn-secondary btn-sm"
                            disabled={busyKey === `void-${v.id}`}
                            aria-label={`Approve void of ${v.quantity} units of ${v.product_name}`}
                            onClick={() => approve(v)}
                          >
                            Approve
                          </button>
                          <button
                            className="btn-secondary btn-sm danger"
                            disabled={busyKey === `void-${v.id}`}
                            aria-label={`Deny void of ${v.quantity} units of ${v.product_name}`}
                            onClick={() => { setActionError(''); setDenying(v); }}
                          >
                            Deny
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {out_of_stock.map((p) => (
                    <tr key={`out-${p.id}`}>
                      <td><span className="chip chip-danger">Out of stock</span></td>
                      <td>
                        <div className="cell-title">
                          <Link className="row-link" to={`/inventory/${p.id}`}>{p.name}</Link>
                        </div>
                      </td>
                      <td className="muted">{p.category} · 0 left</td>
                      <td className="muted">{shortDateTime(p.updated_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn-secondary btn-sm"
                            aria-label={`Restock ${p.name}`}
                            onClick={() => setRestocking(p)}
                          >
                            Restock
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {low_stock.map((p) => (
                    <tr key={`low-${p.id}`}>
                      <td><span className="chip chip-warning">Low stock</span></td>
                      <td>
                        <div className="cell-title">
                          <Link className="row-link" to={`/inventory/${p.id}`}>{p.name}</Link>
                        </div>
                      </td>
                      <td className="muted">{p.category} · {p.quantity.toLocaleString()} left</td>
                      <td className="muted">{shortDateTime(p.updated_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn-secondary btn-sm"
                            aria-label={`Restock ${p.name}`}
                            onClick={() => setRestocking(p)}
                          >
                            Restock
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <DenyModal request={denying} onClose={() => setDenying(null)} onConfirm={confirmDeny} />
      <RestockModal item={restocking} onClose={() => setRestocking(null)} onDone={load} />
    </>
  );
}