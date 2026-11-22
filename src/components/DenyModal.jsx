import { useEffect, useRef, useState } from 'react';

export default function DenyModal({ request, onClose, onConfirm }) {
  const ref = useRef(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = Boolean(request);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setReason('');
      setError('');
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  async function submit(e) {
    e.preventDefault();
    const r = reason.trim();
    if (!r) return setError('Please give a reason for denying this request');
    setBusy(true);
    setError('');
    try {
      await onConfirm(r);
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
        <h2 className="section-title">Deny void request</h2>
        <p className="muted">
          {request?.quantity?.toLocaleString()} unit{request?.quantity === 1 ? '' : 's'} ·{' '}
          {request?.reason === 'damage' ? 'Damage' : 'Return'}
          {request?.by_name ? ` · requested by ${request.by_name}` : ''}
        </p>

        <label className="field">
          <span>Reason for denying</span>
          <input
            className="input"
            maxLength={200}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {error && <div className="alert-danger" role="alert">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => ref.current.close()}>Cancel</button>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Deny request'}
          </button>
        </div>
      </form>
    </dialog>
  );
}