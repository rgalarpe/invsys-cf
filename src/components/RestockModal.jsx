import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function RestockModal({ item, onClose, onDone }) {
  const ref = useRef(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = Boolean(item);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setQty('');
      setNote('');
      setError('');
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) return setError('Enter a whole number of at least 1');
    setBusy(true);
    try {
      await api(`/products/${item.id}/restock`, {
        method: 'POST',
        body: { quantity: n, note: note || undefined },
      });
      await onDone();
      ref.current?.close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}
    >
      <form className="modal-body" onSubmit={submit}>
        <h2 className="section-title">Restock</h2>
        <p className="muted">{item?.name}</p>

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

        {error && <div className="alert-danger" role="alert">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => ref.current.close()}>Cancel</button>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Restock'}
          </button>
        </div>
      </form>
    </dialog>
  );
}