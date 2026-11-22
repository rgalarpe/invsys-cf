import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { money, shortDateTime } from '../format.js';
import { STATUS } from '../status.js';

// Chart colors (same values as --accent-tint, --accent, --divider, --text-muted in styles.css)
const TINT = '#C7CBFA';
const ACCENT = '#4F46E5';
const GRID = '#EEF0F4';
const AXIS = '#5B6475';

const dayLabel = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/* ---------------- Consumption chart ---------------- */
function ConsumptionChart({ productId, refreshKey }) {
  const [bucket, setBucket] = useState('day');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;
    setError('');
    api(`/products/${productId}/consumption?bucket=${bucket}`)
      .then((d) => { if (!ignore) setData(d); })
      .catch((e) => { if (!ignore) setError(e.message); });
    return () => { ignore = true; };
  }, [productId, bucket, refreshKey]);

  const series = data?.series ?? [];
  const max = Math.max(0, ...series.map((p) => p.qty));
  const peak = max > 0 ? series.findIndex((p) => p.qty === max) : -1;
  const labelFor = (d) => (bucket === 'week' ? `Week of ${dayLabel(d)}` : dayLabel(d));

  return (
    <div className="card span-4">
      <div className="card-head" style={{ padding: 0, marginBottom: 12 }}>
        <div>
          <h2 className="section-title">Consumption</h2>
          <p className="muted">
            Units sold, last 60 days{data ? ` · ${data.total.toLocaleString()} total` : ''}
          </p>
        </div>
        <div className="pills">
          {['day', 'week'].map((b) => (
            <button
              key={b}
              className={`pill ${bucket === b ? 'active' : ''}`}
              aria-pressed={bucket === b}
              onClick={() => setBucket(b)}
            >
              {b === 'day' ? 'Daily' : 'Weekly'}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert-danger" role="alert">{error}</div>}

      {!data && !error ? (
        <div className="empty">Loading…</div>
      ) : data && data.total === 0 ? (
        <div className="empty">No sales recorded in this period.</div>
      ) : data ? (
        <div className="chart-box">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis
                dataKey="date"
                tickFormatter={dayLabel}
                tick={{ fill: AXIS, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: AXIS, fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ fill: '#F5F6F9' }}
                labelFormatter={labelFor}
                formatter={(v) => [v, 'Sold']}
                contentStyle={{ borderRadius: 12, border: '1px solid #E6E8EE', boxShadow: 'none' }}
              />
              <Bar dataKey="qty" radius={[6, 6, 0, 0]} maxBarSize={28}>
                {series.map((_, i) => (
                  <Cell key={i} fill={i === peak ? ACCENT : TINT} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- History ---------------- */
const HISTORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'sold', label: 'Sold' },
  { key: 'restock', label: 'Restock' },
  { key: 'void', label: 'Void' },
  { key: 'price_update', label: 'Price' },
];

function typeChip(r) {
  if (r.type === 'void') {
    if (r.void_status === 'pending') return { label: 'Void · Pending', cls: 'chip-warning' };
    if (r.void_status === 'approved') return { label: 'Void · Approved', cls: 'chip-danger' };
    return { label: 'Void · Denied', cls: 'chip-neutral' };
  }
  if (r.type === 'restock') return { label: 'Restock', cls: 'chip-success' };
  if (r.type === 'sold') return { label: 'Sold', cls: 'chip-info' };
  if (r.type === 'price_update') return { label: 'Price update', cls: 'chip-neutral' };
  return { label: 'Created', cls: 'chip-neutral' };
}

function details(r) {
  if (r.type === 'price_update') {
    return `${money(r.prev_unit_price_cents ?? 0)} → ${money(r.unit_price_cents)}`;
  }
  if (r.type === 'void') {
    const parts = [r.reason === 'damage' ? 'Damage' : 'Return'];
    if (r.note) parts.push(r.note);
    if (r.void_status === 'denied' && r.deny_reason) parts.push(`Denied: ${r.deny_reason}`);
    return parts.join(' · ');
  }
  return r.note || '';
}

const SIGN = { sold: '−', void: '−', restock: '+', create: '+' };

function HistoryCard({ productId, refreshKey }) {
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { setPage(1); }, [type, productId]);

  useEffect(() => {
    let ignore = false;
    setError('');
    api(`/products/${productId}/history?type=${type}&page=${page}`)
      .then((d) => { if (!ignore) setData(d); })
      .catch((e) => { if (!ignore) setError(e.message); });
    return () => { ignore = true; };
  }, [productId, type, page, refreshKey]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 20;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="card flush span-4">
      <div className="card-head">
        <h2 className="section-title">History</h2>
        <div className="pills">
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`pill ${type === f.key ? 'active' : ''}`}
              aria-pressed={type === f.key}
              onClick={() => setType(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert-danger" style={{ margin: '0 22px 16px' }} role="alert">{error}</div>}

      {!data && !error ? (
        <div className="empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty">No history yet.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="r">Qty</th>
                <th>By</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const chip = typeChip(r);
                return (
                  <tr key={`${r.src}-${r.id}`}>
                    <td className="muted">{shortDateTime(r.happened_at)}</td>
                    <td><span className={`chip ${chip.cls}`}>{chip.label}</span></td>
                    <td className="r">
                      {r.type === 'price_update' ? '—' : `${SIGN[r.type] ?? ''}${r.quantity.toLocaleString()}`}
                    </td>
                    <td>{r.by_name}</td>
                    <td className="muted">{details(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > pageSize && (
        <div className="pager">
          <span className="muted num">Showing {from}–{to} of {total}</span>
          <div className="pager-btns">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button className="btn-secondary" disabled={to >= total} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Mark sold form ---------------- */
function SellForm({ item, onSold }) {
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const available = Math.max(0, item.quantity - item.pending_void_qty);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api(`/products/${item.id}/sold`, {
        method: 'POST',
        body: { quantity: Number(qty), note: note || undefined },
      });
      setQty('');
      setNote('');
      onSold(d.item);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card span-4" onSubmit={submit}>
      <h2 className="section-title">Mark sold</h2>
      <p className="muted" style={{ marginBottom: 14 }}>
        {available.toLocaleString()} unit{available === 1 ? '' : 's'} available to sell
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Quantity</span>
          <input
            className="input num"
            type="number"
            min="1"
            step="1"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input
            className="input"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button className="btn-primary" type="submit" disabled={busy || available === 0}>
          {busy ? 'Saving…' : 'Mark sold'}
        </button>
      </div>
      {error && <div className="alert-danger" style={{ marginTop: 12 }} role="alert">{error}</div>}
    </form>
  );
}

/* ---------------- Page ---------------- */
export default function ItemDetail() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    setItem(null);
    setError('');
    api(`/products/${id}`)
      .then((d) => { if (!ignore) setItem(d.item); })
      .catch((e) => { if (!ignore) setError(e.status === 404 ? 'Item not found.' : e.message); });
    return () => { ignore = true; };
  }, [id]);

  const back = (
    <Link to="/inventory" className="back-link">
      <ArrowLeft size={16} strokeWidth={1.75} /> Inventory
    </Link>
  );

  if (error) {
    return (
      <>
        {back}
        <div className="alert-danger" role="alert">{error}</div>
      </>
    );
  }
  if (!item) {
    return (
      <>
        {back}
        <div className="muted">Loading…</div>
      </>
    );
  }

  const st = STATUS[item.status];

  return (
    <>
      {back}
      <div className="page-head">
        <div>
          <h1 className="page-title">{item.name}</h1>
          <p className="muted">{item.category}</p>
        </div>
        <span className={`chip ${st.cls}`}>{st.label}</span>
      </div>

      <div className="bento">
        <div className="card">
          <div className="stat-label">Quantity</div>
          <div className="stat-value">{item.quantity.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="stat-label">Unit price</div>
          <div className="stat-value">{money(item.unit_price_cents)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Stock value</div>
          <div className="stat-value">{money(item.quantity * item.unit_price_cents)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Pending void</div>
          <div className="stat-value">{item.pending_void_qty.toLocaleString()}</div>
        </div>

        <ConsumptionChart productId={item.id} refreshKey={refreshKey} />
        <SellForm
          item={item}
          onSold={(updated) => {
            setItem(updated);
            setRefreshKey((k) => k + 1);
          }}
        />
        <HistoryCard productId={item.id} refreshKey={refreshKey} />
      </div>
    </>
  );
}