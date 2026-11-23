import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { shortDate } from '../format.js';

// No look-alike characters (0/O, 1/l/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(len = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

function Modal({ open, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    else if (!open && dlg.open) dlg.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}
    >
      {/* Children mount only while open, so every form starts fresh */}
      {open ? children : null}
    </dialog>
  );
}

function PasswordInput({ value, onChange }) {
  return (
    <div className="pw-row">
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        required
      />
      <button type="button" className="btn-secondary" onClick={() => onChange(generatePassword())}>
        Generate
      </button>
    </div>
  );
}

function Secret({ password, onDone }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      /* clipboard may be blocked; the password is still visible */
    }
  }
  return (
    <div className="modal-body">
      <h2 className="section-title">Temporary password</h2>
      <p className="muted">
        Share it with the user through a private channel. They must choose their own password when
        they first sign in. This is the last time it is shown here.
      </p>
      <div className="secret">{password}</div>
      <div className="modal-actions">
        <button className="btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="btn-primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

function CreateUser({ onCreated, onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api('/admin/users', { method: 'POST', body: { name, email, role, password } });
      onCreated(d.item);
      setDone(password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Secret password={done} onDone={onClose} />;

  return (
    <form className="modal-body" onSubmit={submit}>
      <h2 className="section-title">Add user</h2>
      <label className="field">
        <span>Name</span>
        <input className="input" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Email</span>
        <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Role</span>
        <select className="input" required value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="" disabled>Select a role…</option>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label className="field">
        <span>Temporary password</span>
        <PasswordInput value={password} onChange={setPassword} />
      </label>
      {error && <div className="alert-danger" role="alert">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create user'}
        </button>
      </div>
    </form>
  );
}

function ResetPassword({ target, onReset, onClose }) {
  const [password, setPassword] = useState(generatePassword());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api(`/admin/users/${target.id}/reset-password`, { method: 'POST', body: { password } });
      onReset(target.id);
      setDone(password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Secret password={done} onDone={onClose} />;

  return (
    <form className="modal-body" onSubmit={submit}>
      <h2 className="section-title">Reset password</h2>
      <p className="muted">
        {target.name} ({target.email}) will be signed out everywhere and must choose a new password
        at next sign-in.
      </p>
      <label className="field">
        <span>New temporary password</span>
        <PasswordInput value={password} onChange={setPassword} />
      </label>
      {error && <div className="alert-danger" role="alert">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Reset password'}
        </button>
      </div>
    </form>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    api('/admin/users')
      .then((d) => setItems(d.items))
      .catch((e) => setError(e.message));
  }, []);

  async function toggleActive(u) {
    const next = !u.is_active;
    if (!next && !window.confirm(`Deactivate ${u.name}? They will be signed out immediately.`)) return;
    setError('');
    setBusyId(u.id);
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: next } });
      setItems((list) => list.map((x) => (x.id === u.id ? { ...x, is_active: next ? 1 : 0 } : x)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="muted">Create accounts and manage access</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ Add user</button>
      </div>

      {error && <div className="alert-danger" role="alert">{error}</div>}

      <div className="card flush">
        {!items ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((u) => {
                  const self = u.id === me.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="cell-title">{u.name}{self ? ' (you)' : ''}</div>
                        <div className="cell-sub">{u.email}</div>
                      </td>
                      <td>
                        <span className={`chip ${u.role === 'admin' ? 'chip-info' : 'chip-neutral'}`}>
                          {u.role === 'admin' ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td>
                        <span className={`chip ${u.is_active ? 'chip-success' : 'chip-neutral'}`}>
                          {u.is_active ? 'Active' : 'Deactivated'}
                        </span>
                        {u.must_change_password ? (
                          <div className="cell-sub">Must change password</div>
                        ) : null}
                      </td>
                      <td className="muted">{shortDate(u.created_at)}</td>
                      <td>
                        {!self && (
                          <div className="row-actions">
                            <button
                              className="btn-secondary btn-sm"
                              disabled={busyId === u.id}
                              onClick={() => setResetting(u)}
                            >
                              Reset password
                            </button>
                            <button
                              className={`btn-secondary btn-sm ${u.is_active ? 'danger' : ''}`}
                              disabled={busyId === u.id}
                              onClick={() => toggleActive(u)}
                            >
                              {u.is_active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)}>
        <CreateUser
          onCreated={(item) => setItems((list) => [item, ...(list || [])])}
          onClose={() => setCreating(false)}
        />
      </Modal>

      <Modal open={Boolean(resetting)} onClose={() => setResetting(null)}>
        {resetting && (
          <ResetPassword
            target={resetting}
            onReset={(id) =>
              setItems((list) => list.map((x) => (x.id === id ? { ...x, must_change_password: 1 } : x)))
            }
            onClose={() => setResetting(null)}
          />
        )}
      </Modal>
    </>
  );
}