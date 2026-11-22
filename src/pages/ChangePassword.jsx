import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function ChangePassword() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return <Navigate to="/login" replace />;
  const forced = Boolean(user.must_change_password);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (next.length < 10) return setError('New password must be at least 10 characters');
    if (next !== confirm) return setError('The new passwords do not match');
    setBusy(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { current_password: current, new_password: next },
      });
      setUser({ ...user, must_change_password: 0 });
      navigate('/inventory', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card login-card" onSubmit={submit}>
        <h1 className="page-title">{forced ? 'Set a new password' : 'Change password'}</h1>
        <p className="muted">
          {forced
            ? 'Your account uses a temporary password. Choose your own to continue.'
            : 'Other devices will be signed out when you change it.'}
        </p>

        <label className="field">
          <span>{forced ? 'Temporary password' : 'Current password'}</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          <span>New password (at least 10 characters)</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>

        {error && <div className="alert-danger" role="alert">{error}</div>}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>

        {forced ? (
          <button type="button" className="btn-secondary" onClick={logout}>Sign out</button>
        ) : (
          <Link to="/inventory" className="back-link">Cancel</Link>
        )}
      </form>
    </div>
  );
}