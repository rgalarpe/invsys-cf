export default function AdminDashboard() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="muted">Stock overview</p>
        </div>
      </div>

      <div className="bento">
        <div className="card span-2">
          <div className="stat-label">Total stock value</div>
          <div className="stat-value">0.00</div>
          <p className="muted stat-note">Chart goes here in Phase 8</p>
        </div>
        <div className="card">
          <div className="stat-label">Low stock items</div>
          <div className="stat-value">0</div>
          <div className="progress"><div style={{ width: '35%' }} /></div>
        </div>
        <div className="card">
          <div className="stat-label">Out of stock</div>
          <div className="stat-value">0</div>
        </div>
      </div>
    </>
  );
}