import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const PRICE_RE = /^\d{1,7}(\.\d{1,2})?$/;

export default function ItemFormModal({
  open, mode, item, categories, onClose, onSaved, onCategoryCreated,
}) {
  const ref = useRef(null);
  const nameRef = useRef(null);
  const isEdit = mode === 'edit';

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('0');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setName(isEdit ? item.name : '');
      setCategoryId(isEdit ? String(item.category_id) : '');
      setNewCategory('');
      setPrice(isEdit ? (item.unit_price_cents / 100).toFixed(2) : '');
      setQty('0');
      setError('');
      setNotice('');
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setError('');
    setNotice('');

    const trimmed = name.trim();
    if (!trimmed) return setError('Name is required');
    if (!PRICE_RE.test(price.trim())) return setError('Enter a valid price, e.g. 15.00');
    if (categoryId === '') return setError('Choose a category');
    if (categoryId === 'new' && !newCategory.trim()) return setError('Enter a category name');
    const initial = Number(qty);
    if (!isEdit && (!Number.isInteger(initial) || initial < 0)) {
      return setError('Initial quantity must be a whole number, 0 or more');
    }
    const cents = Math.round(parseFloat(price) * 100);

    setBusy(true);
    try {
      let cid = categoryId;
      if (cid === 'new') {
        const d = await api('/categories', { method: 'POST', body: { name: newCategory.trim() } });
        onCategoryCreated(d.item);
        cid = String(d.item.id);
        setCategoryId(cid); // so a retry after a later failure doesn't create it twice
        setNewCategory('');
      }

      const d = isEdit
        ? await api(`/products/${item.id}`, {
            method: 'PATCH',
            body: { name: trimmed, category_id: Number(cid), unit_price_cents: cents },
          })
        : await api('/products', {
            method: 'POST',
            body: { name: trimmed, category_id: Number(cid), unit_price_cents: cents, quantity: initial },
          });

      onSaved(d.item);

      if (isEdit) {
        ref.current?.close();
      } else {
        // Stay open so several items can be added in a row
        setNotice(`Added ${d.item.name}.`);
        setName('');
        setPrice('');
        setQty('0');
        nameRef.current?.focus();
      }
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
        <h2 className="section-title">{isEdit ? 'Edit item' : 'Add item'}</h2>

        <label className="field">
          <span>Name</span>
          <input
            ref={nameRef}
            className="input"
            maxLength={100}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Category</span>
          <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Select…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="new">+ New category…</option>
          </select>
        </label>

        {categoryId === 'new' && (
          <label className="field">
            <span>New category name</span>
            <input className="input" maxLength={50} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          </label>
        )}

        <div className="field-row">
          <label className="field">
            <span>Unit price</span>
            <input
              className="input num"
              inputMode="decimal"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          {!isEdit && (
            <label className="field">
              <span>Initial quantity</span>
              <input
                className="input num"
                type="number"
                min="0"
                step="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>
          )}
        </div>

        {notice && <div className="alert-success" role="status">{notice}</div>}
        {error && <div className="alert-danger" role="alert">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => ref.current.close()}>
            {isEdit ? 'Cancel' : 'Close'}
          </button>
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}
          </button>
        </div>
      </form>
    </dialog>
  );
}