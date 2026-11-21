import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Package, LogOut } from 'lucide-react';
import { useAuth } from '../auth.jsx';

const ICON = { size: 18, strokeWidth: 1.75 };

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-tile" aria-hidden="true" />
          Inventory
        </div>

        <nav>
          {user.role === 'admin' && (
            <NavLink to="/admin" className="nav-link">
              <LayoutDashboard {...ICON} /> Dashboard
            </NavLink>
          )}
          <NavLink to="/inventory" className="nav-link">
            <Package {...ICON} /> Inventory
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <div className="who">
            <strong>{user.name}</strong>
            <span>{user.role}</span>
          </div>
          <button className="signout" onClick={logout}>
            <LogOut size={16} strokeWidth={1.75} /> Sign out
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}