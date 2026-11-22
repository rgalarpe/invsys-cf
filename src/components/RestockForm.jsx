import { useState } from 'react';
import { api } from '../api.js';

export default function RestockForm({ item, onDone }) {
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api(`/products/${item.id}/restock`, {
        method: 'POST',
        body: { quantity: Number(qty), note: note || undefined },
      });
      setQty('');
      setNote('');
      onDone(d.item);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card span-4" onSubmit={submit}>
      <h2 className="section-title">Restock</h2>
      <p className="muted" style={{ marginBottom: 14 }}>
        Current quantity: {item.quantity.toLocaleString()}
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Quantity to add</span>
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
          <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Restock'}
        </button>
      </div>
      {error && <div className="alert-danger" style={{ marginTop: 12 }} role="alert">{error}</div>}
    </form>
  );
}