import { useState } from 'react';
import { api } from '../api.js';

export default function VoidForm({ item, isAdmin, onDone }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('damage');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const available = Math.max(0, item.quantity - item.pending_void_qty);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const d = await api(`/products/${item.id}/void`, {
        method: 'POST',
        body: { quantity: Number(qty), reason, note: note || undefined },
      });
      setQty('');
      setNote('');
      setNotice(d.auto_approved ? 'Void recorded.' : 'Void request sent. It counts once an admin approves it.');
      onDone(d.item);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card span-2" onSubmit={submit}>
      <h2 className="section-title">{isAdmin ? 'Record void' : 'Request void'}</h2>
      <p className="muted" style={{ marginBottom: 14 }}>
        {available.toLocaleString()} unit{available === 1 ? '' : 's'} available to void
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
          <span>Reason</span>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="damage">Damage</option>
            <option value="return">Return</option>
          </select>
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn-primary" type="submit" disabled={busy || available === 0}>
          {busy ? 'Saving…' : isAdmin ? 'Record void' : 'Request void'}
        </button>
      </div>
      {notice && <div className="alert-success" style={{ marginTop: 12 }} role="status">{notice}</div>}
      {error && <div className="alert-danger" style={{ marginTop: 12 }} role="alert">{error}</div>}
    </form>
  );
}