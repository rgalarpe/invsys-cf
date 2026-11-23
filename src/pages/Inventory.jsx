import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { STATUS } from '../status.js';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { money, shortDate } from '../format.js';
import ItemFormModal from '../components/ItemFormModal.jsx';



const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'In stock' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
  { key: 'void', label: 'Void' },
];

function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function InventoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status');
  const [status, setStatus] = useState(
    ['in', 'low', 'out', 'void'].includes(initialStatus) ? initialStatus : 'all'
  );
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Page resets to 1 automatically whenever any filter changes
  const filterKey = `${q}|${status}|${category}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (p) => setPageState({ key: filterKey, page: p });

  useEffect(() => {
    api('/categories').then((d) => setCategories(d.items)).catch(() => { });
  }, []);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError('');

    const qs = new URLSearchParams({ page: String(page) });
    if (q) qs.set('q', q);
    if (status !== 'all') qs.set('status', status);
    if (category) qs.set('category', category);

    api(`/products?${qs}`)
      .then((d) => { if (!ignore) setData(d); })
      .catch((e) => { if (!ignore) setError(e.message); })
      .finally(() => { if (!ignore) setLoading(false); });

    return () => { ignore = true; };
  }, [q, status, category, page, reloadKey]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="muted">Track stock levels across all items</p>
        </div>
        <div className="page-actions">
          <div className="search">
            <Search size={16} strokeWidth={1.75} />
            <input
              className="input"
              placeholder="Search items"
              aria-label="Search items"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {user.role === 'admin' && (
            <button className="btn-primary" onClick={() => setAdding(true)}>+ Add item</button>
          )}
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <h2 className="section-title">Stock items</h2>
          <div className="toolbar">
            <select
              className="input select"
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <div className="pills">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`pill ${status === f.key ? 'active' : ''}`}
                  aria-pressed={status === f.key}
                  onClick={() => setStatus(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="alert-danger" style={{ margin: '0 22px 16px' }} role="alert">{error}</div>}

        {!data && loading ? (
          <div className="empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty">No items match your filters.</div>
        ) : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="r">Qty</th>
                  <th className="r">Unit price</th>
                  <th>Status</th>
                  <th>Last update</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/inventory/${r.id}`)}>
                    <td>
                      <div className="cell-title">
                        <Link className="row-link" to={`/inventory/${r.id}`} onClick={(e) => e.stopPropagation()}>
                          {r.name}
                        </Link>
                      </div>
                      {r.pending_void_qty > 0 && (
                        <div className="cell-sub">{r.pending_void_qty} pending void</div>
                      )}
                    </td>
                    <td>{r.category}</td>
                    <td className="r">{r.quantity.toLocaleString()}</td>
                    <td className="r">{money(r.unit_price_cents)}</td>
                    <td>
                      <span className={`chip ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                    </td>
                    <td className="muted">{shortDate(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <div className="pager">
            <span className="muted num">Showing {from}–{to} of {total}</span>
            <div className="pager-btns">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button className="btn-secondary" disabled={to >= total} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
      {user.role === 'admin' && (
        <ItemFormModal
          open={adding}
          mode="create"
          categories={categories}
          onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
          onClose={() => setAdding(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
      {user.role === 'admin' && (
        <ItemFormModal
          open={adding}
          mode="create"
          categories={categories}
          onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
          onClose={() => setAdding(false)}
          onSaved={(created) => navigate(`/inventory/${created.id}`)}
        />
      )}
    </>
  );
}