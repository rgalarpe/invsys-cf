import { useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '../auth.jsx';

const SAMPLE = [
  { id: 1, name: 'Bottled Water 500ml', category: 'Beverages', qty: 120, price: '15.00', status: 'in' },
  { id: 2, name: 'Chips Family Pack', category: 'Snacks', qty: 35, price: '45.00', status: 'low' },
  { id: 3, name: 'Dish Soap 1L', category: 'Household', qty: 0, price: '95.00', status: 'out' },
];

const STATUS = {
  in: { label: 'In stock', cls: 'chip-success' },
  low: { label: 'Low stock', cls: 'chip-warning' },
  out: { label: 'Out of stock', cls: 'chip-danger' },
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
];

export default function InventoryPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');
  const rows = SAMPLE.filter((r) => filter === 'all' || r.status === filter);

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
            <input className="input" placeholder="Search items" aria-label="Search items" />
          </div>
          {user.role === 'admin' && <button className="btn-primary">+ Add item</button>}
        </div>
      </div>

      <div className="card flush">
        <div className="card-head">
          <h2 className="section-title">Stock items</h2>
          <div className="pills">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                className={`pill ${filter === f.key ? 'active' : ''}`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th className="r">Qty</th>
                <th className="r">Unit price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable">
                  <td><div className="cell-title">{r.name}</div></td>
                  <td>{r.category}</td>
                  <td className="r">{r.qty}</td>
                  <td className="r">{r.price}</td>
                  <td><span className={`chip ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}