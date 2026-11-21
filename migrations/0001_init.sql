-- Migration number: 0001 	 2026-11-21T11:42:44.471Z
CREATE TABLE users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  email                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                 TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('admin','user')),
  password_hash        TEXT NOT NULL,            -- base64 PBKDF2 output
  password_salt        TEXT NOT NULL,            -- base64, 16 random bytes
  password_iterations  INTEGER NOT NULL,         -- stored so it can be raised later
  must_change_password INTEGER NOT NULL DEFAULT 1,
  is_active            INTEGER NOT NULL DEFAULT 1,
  created_by           INTEGER REFERENCES users(id),
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,                  -- SHA-256 of the cookie token
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_attempts (
  key          TEXT PRIMARY KEY,                 -- e.g. email + ip
  count        INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

CREATE TABLE categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE products (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category_id      INTEGER NOT NULL REFERENCES categories(id),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),  -- money as integers
  quantity         INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  image_key        TEXT,                         -- optional R2 object key
  is_archived      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))   -- "last update"
);

CREATE TABLE void_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  reason       TEXT NOT NULL CHECK (reason IN ('damage','return')),
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  deny_reason  TEXT,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by  INTEGER REFERENCES users(id),
  reviewed_at  TEXT,
  CHECK (status <> 'denied' OR (deny_reason IS NOT NULL AND length(trim(deny_reason)) > 0))
);

-- Append-only ledger. Never UPDATE or DELETE rows here.
CREATE TABLE inventory_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id            INTEGER NOT NULL REFERENCES products(id),
  type                  TEXT NOT NULL CHECK (type IN ('create','restock','sold','void','price_update')),
  quantity              INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),  -- units; 0 for price_update
  unit_price_cents      INTEGER NOT NULL,        -- price in effect (new price for price_update)
  prev_unit_price_cents INTEGER,                 -- only for price_update
  void_request_id       INTEGER REFERENCES void_requests(id),
  note                  TEXT,
  created_by            INTEGER NOT NULL REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))   -- UTC ISO-8601
);



CREATE INDEX idx_events_product_time ON inventory_events(product_id, created_at);
CREATE INDEX idx_events_type_time    ON inventory_events(type, created_at);
CREATE INDEX idx_void_status         ON void_requests(status, requested_at);
CREATE INDEX idx_void_product        ON void_requests(product_id, status);
CREATE INDEX idx_products_quantity   ON products(quantity);
CREATE INDEX idx_sessions_expiry     ON sessions(expires_at);
